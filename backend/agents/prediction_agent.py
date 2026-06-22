"""
agents/prediction_agent.py — NICU Guardian (Feature 4)

PredictionAgent
━━━━━━━━━━━━━━━
Background task that runs every 60 seconds. For each active bay:

  1. Fetch the last 10 minutes of stress data from MongoDB
  2. Fit a linear regression on  timestamp → stress_index
  3. Project forward 5 minutes
  4. If the projection exceeds 70 → fire an early-warning alert via Groq

This gives nurses up to 5 minutes of advance notice before a crisis develops.

Integration:
  - Started as an asyncio task in main.py lifespan
  - Fires alerts via routers.alerts.push_alert()
  - Deduplicates: won't fire again for the same bay within 5 minutes
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Optional

import numpy as np
from sklearn.linear_model import LinearRegression

from database.queries import get_stress_history


# ── constants ────────────────────────────────────────────────────────────────

POLL_INTERVAL_SECS   = 60     # run analysis every 60 seconds
HISTORY_MINUTES      = 10     # look back 10 minutes
PROJECTION_MINUTES   = 5      # look forward 5 minutes
CRITICAL_THRESHOLD   = 70     # stress index threshold for early warning
MIN_DATA_POINTS      = 10     # minimum data points needed for regression
DEDUP_MINUTES        = 5      # don't re-alert same bay within this window


# ── Groq prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the NICU Guardian Predictive Alert system. You generate early-warning
messages for NICU nursing staff based on stress trend analysis.

Keep messages under 60 words. Be specific about the projected timeline.
Use clinical language appropriate for a neonatal ICU setting."""

USER_PROMPT_TPL = """\
Predictive analysis for Bay {bay}:
- Current stress index: {current:.0f}/100
- Trend over last {history_min} minutes: {trend}
- Linear regression slope: {slope:.2f} points/minute
- Projected stress in {proj_min} minutes: {projected:.0f}/100
- This exceeds the critical threshold of {threshold}.

Generate a concise early-warning alert for the nursing station.
Include the bay ID, current stress, projected stress, and estimated
time to critical threshold."""


# ── agent class ──────────────────────────────────────────────────────────────

class PredictionAgent:
    """
    Background prediction agent.

    Usage:
        agent = PredictionAgent()
        asyncio.create_task(agent.run_loop())   # start in lifespan
        agent.cancel()                          # stop on shutdown
    """

    def __init__(self) -> None:
        # {bay → last_prediction_alert_time} for deduplication
        self._last_alert: Dict[str, datetime] = {}
        self._task: Optional[asyncio.Task] = None

    # ── background loop ──────────────────────────────────────────────────────

    async def run_loop(self) -> None:
        """
        Main loop — runs indefinitely, polling every POLL_INTERVAL_SECS.
        Should be started as an asyncio.create_task() in FastAPI lifespan.
        """
        print("🔮  Prediction agent started (polling every 60s)")

        while True:
            try:
                await self._analyse_all_bays()
            except asyncio.CancelledError:
                print("🔮  Prediction agent stopped")
                return
            except Exception as exc:
                print(f"⚠️  Prediction agent error: {exc}")

            await asyncio.sleep(POLL_INTERVAL_SECS)

    def cancel(self) -> None:
        """Cancel the background task gracefully."""
        if self._task and not self._task.done():
            self._task.cancel()

    # ── per-bay analysis ─────────────────────────────────────────────────────

    async def _analyse_all_bays(self) -> None:
        """
        Iterate over all known bays (discovered from audio router accumulators)
        and run regression analysis on each.
        """
        # Import here to avoid circular imports; get known bay IDs
        try:
            from routers.audio import _accumulators
            bays = list(_accumulators.keys())
        except ImportError:
            bays = []

        if not bays:
            return  # no audio data yet — nothing to predict

        for bay in bays:
            try:
                await self._analyse_bay(bay)
            except Exception as exc:
                print(f"⚠️  Prediction analysis failed for {bay}: {exc}")

    async def _analyse_bay(self, bay: str) -> None:
        """
        Fetch stress history, fit linear regression, project forward,
        and fire an alert if the projection exceeds the critical threshold.
        """
        # Fetch data
        events = await get_stress_history(bay, HISTORY_MINUTES)

        if len(events) < MIN_DATA_POINTS:
            return  # not enough data for meaningful regression

        # Build arrays for regression
        # X = seconds since first event, Y = stress_index
        t0 = events[0]["timestamp"]
        X = np.array([
            (e["timestamp"] - t0).total_seconds() for e in events
        ]).reshape(-1, 1)
        Y = np.array([e["stress_index"] for e in events])

        # Fit linear regression
        model = LinearRegression()
        model.fit(X, Y)

        # Slope in stress points per second → convert to per minute
        slope_per_sec = float(model.coef_[0])
        slope_per_min = slope_per_sec * 60

        # Current stress (latest smoothed value)
        current = float(Y[-1])

        # Project forward
        last_t = float(X[-1][0])
        projection_secs = PROJECTION_MINUTES * 60
        projected = float(model.predict(
            np.array([[last_t + projection_secs]])
        )[0])

        # Only alert if projected stress exceeds threshold AND slope is positive
        if projected <= CRITICAL_THRESHOLD or slope_per_min <= 0:
            return

        # Deduplication check
        now = datetime.utcnow()
        last_alert_time = self._last_alert.get(bay)
        if last_alert_time and (now - last_alert_time).total_seconds() < DEDUP_MINUTES * 60:
            return  # already alerted recently for this bay

        # Determine trend description
        if slope_per_min > 2:
            trend = f"rapidly rising (+{slope_per_min:.1f}/min)"
        elif slope_per_min > 0.5:
            trend = f"steadily rising (+{slope_per_min:.1f}/min)"
        else:
            trend = f"slowly rising (+{slope_per_min:.1f}/min)"

        # Calculate estimated time to critical (from current level)
        if current < CRITICAL_THRESHOLD and slope_per_sec > 0:
            time_to_critical_secs = (CRITICAL_THRESHOLD - current) / slope_per_sec
            eta_minutes = time_to_critical_secs / 60
        else:
            eta_minutes = 0  # already critical or will be very soon

        # Fire alert
        await self._fire_prediction_alert(
            bay=bay,
            current=current,
            projected=projected,
            slope=slope_per_min,
            trend=trend,
            eta_minutes=eta_minutes,
        )

        self._last_alert[bay] = now

    # ── alert firing ─────────────────────────────────────────────────────────

    async def _fire_prediction_alert(
        self,
        bay: str,
        current: float,
        projected: float,
        slope: float,
        trend: str,
        eta_minutes: float,
    ) -> None:
        """Generate a Groq early-warning message and push it."""
        from routers.alerts import push_alert
        from database.schemas import AlertType

        # Build Groq prompt
        user_prompt = USER_PROMPT_TPL.format(
            bay=bay,
            current=current,
            history_min=HISTORY_MINUTES,
            trend=trend,
            slope=slope,
            proj_min=PROJECTION_MINUTES,
            projected=projected,
            threshold=CRITICAL_THRESHOLD,
        )

        body = await self._call_groq(user_prompt)

        eta_str = f"{eta_minutes:.0f}min" if eta_minutes > 0 else "imminent"

        alert = {
            "type":          AlertType.PREDICTION,
            "incubator_id":  bay,
            "title":         f"🔮 Bay {bay} — Early Warning (ETA: {eta_str})",
            "body":          body,
            "severity":      "medium",
            "agent":         "prediction_agent",
            "stress_index":  current,
            "projected_stress": projected,
            "slope_per_min": slope,
            "eta_minutes":   eta_minutes,
        }

        await push_alert(alert)
        print(
            f"🔮  Prediction alert: {bay} → projected {projected:.0f} "
            f"in {PROJECTION_MINUTES}min (slope={slope:.1f}/min, ETA={eta_str})"
        )

    # ── Groq wrapper with fallback ───────────────────────────────────────────

    async def _call_groq(self, user_prompt: str) -> str:
        """Call Groq for early-warning text, with graceful fallback."""
        try:
            from utils.groq_client import chat
            return await chat(
                system=SYSTEM_PROMPT,
                user=user_prompt,
                max_tokens=150,
                temperature=0.3,
            )
        except RuntimeError as exc:
            print(f"⚠️  Groq unavailable for prediction: {exc}")
            return (
                "AI analysis unavailable — API key not configured. "
                "Stress trend analysis indicates rising trajectory. "
                "Proactive assessment recommended."
            )
        except Exception as exc:
            print(f"⚠️  Groq prediction call failed: {exc}")
            return (
                "AI analysis temporarily unavailable. "
                "Stress trajectory is rising — proactive check recommended."
            )


# ── module-level singleton ───────────────────────────────────────────────────

prediction_agent = PredictionAgent()
