"""
agents/escalation_agent.py — NICU Guardian (Feature 2)

EscalationLoopAgent
━━━━━━━━━━━━━━━━━━━
Autonomous 3-level escalation loop:

  Level 0 → (stress > 70 for ≥ 10 s)   → Level 1: alert nurse station
  Level 1 → (no nurse response for 90 s) → Level 2: escalate to charge nurse
  Level 2 → (no response for another 90s) → Level 3: escalate to on-call doctor

The agent is called on **every audio frame** (~500 ms) by the audio router.
It only calls Groq on level transitions (not every frame), respecting the
30 RPM free-tier limit.

When it fires a Level 1 alert, it also triggers the RootCauseAgent to
investigate *why* stress is elevated and attaches the hypothesis.

Integration:
  audio.py  →  escalation_agent.check(bay, stress, classifications, nurse_present)
            →  push_alert() via routers/alerts.py
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Optional

from services.alarm_fatigue import AlarmFatigueDetector
from database.schemas import AlertType


# ── per-bay escalation state ─────────────────────────────────────────────────

class _BayState:
    """Tracks escalation state for a single incubator bay."""

    __slots__ = ("critical_since", "level", "last_alert_id",
                 "level_changed_at", "classifications")

    def __init__(self) -> None:
        self.critical_since: Optional[datetime] = None  # when stress first exceeded 70
        self.level: int = 0                              # 0=normal, 1=nurse, 2=charge, 3=doctor
        self.last_alert_id: Optional[str] = None
        self.level_changed_at: Optional[datetime] = None
        self.classifications: dict = {}

    def reset(self) -> None:
        self.critical_since = None
        self.level = 0
        self.last_alert_id = None
        self.level_changed_at = None
        self.classifications = {}


# ── Groq prompt templates ────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the NICU Guardian clinical alert system in a neonatal intensive care unit.
You generate concise, actionable alert messages for medical staff.
Keep messages under 80 words. Use clinical terminology appropriately.
Never speculate beyond the data provided. Be direct and urgent when severity is high."""

LEVEL_CONFIG = {
    1: {
        "target":   "Nurse Station",
        "severity": "high",
        "title_tpl": "⚠️ Bay {bay} — Elevated Stress Alert",
        "prompt_tpl": (
            "Bay {bay} stress index has been critically elevated at {stress:.0f}/100 "
            "for {duration:.0f} seconds.\n"
            "Audio classifications: Cry {cry:.0%}, Alarm {alarm:.0%}, Ambient {ambient:.0%}.\n"
            "dB level: {db:.0f} dB.\n\n"
            "Generate a concise Level 1 alert for the NURSE STATION. "
            "Include the bay ID, stress level, likely cause based on classifications, "
            "and recommended immediate action."
        ),
    },
    2: {
        "target":   "Charge Nurse",
        "severity": "high",
        "title_tpl": "🔴 Bay {bay} — Escalation to Charge Nurse",
        "prompt_tpl": (
            "Bay {bay} has had a critical stress index of {stress:.0f}/100 for "
            "{duration:.0f} seconds. A Level 1 nurse alert was sent {since_l1:.0f} "
            "seconds ago but NO nurse response has been detected.\n"
            "Classifications: Cry {cry:.0%}, Alarm {alarm:.0%}.\n\n"
            "Generate a Level 2 escalation alert for the CHARGE NURSE. "
            "Emphasise that the initial alert went unanswered and immediate "
            "bedside assessment is required."
        ),
    },
    3: {
        "target":   "On-Call Doctor",
        "severity": "high",
        "title_tpl": "🚨 Bay {bay} — Escalation to On-Call Doctor",
        "prompt_tpl": (
            "CRITICAL: Bay {bay} stress index at {stress:.0f}/100 for {duration:.0f} "
            "seconds. Level 1 (nurse) and Level 2 (charge nurse) alerts went "
            "unanswered for over {since_l1:.0f} seconds.\n"
            "Classifications: Cry {cry:.0%}, Alarm {alarm:.0%}.\n\n"
            "Generate a Level 3 URGENT escalation for the ON-CALL DOCTOR. "
            "This is the highest severity. State that all prior alerts were "
            "unanswered and immediate medical intervention is needed."
        ),
    },
}


# ── agent class ──────────────────────────────────────────────────────────────

class EscalationLoopAgent:
    """
    Autonomous escalation agent.

    Call ``check()`` on every audio frame. The agent handles its own
    timing and only calls Groq on level transitions.
    """

    # Thresholds
    STRESS_CRITICAL    = 40      # lowered for demo — alerts trigger sooner
    INITIAL_DELAY_SECS = 5       # seconds of sustained stress before Level 1
    ESCALATION_DELAY   = 90      # seconds between escalation levels

    def __init__(self) -> None:
        self._bays: Dict[str, _BayState] = {}
        self._fatigue = AlarmFatigueDetector(threshold=3, window_minutes=10)
        self._root_cause_agent = None  # lazy import to avoid circular deps

    def _get_state(self, bay: str) -> _BayState:
        if bay not in self._bays:
            self._bays[bay] = _BayState()
        return self._bays[bay]

    async def check(
        self,
        bay: str,
        smoothed_stress: float,
        classifications: dict | None = None,
        db_level: float = 50.0,
        nurse_present: bool = False,
    ) -> Optional[str]:
        """
        Called every ~500ms by the audio router.

        Parameters
        ----------
        bay               Incubator bay ID
        smoothed_stress   Smoothed stress index [0–100]
        classifications   {cry, alarm, ambient} probabilities
        db_level          Raw dB level
        nurse_present     Whether the visual pipeline detected a nurse

        Returns
        -------
        str | None        Alert ID if an alert was fired, else None
        """
        state = self._get_state(bay)
        now   = datetime.utcnow()
        clf   = classifications or {"cry": 0, "alarm": 0, "ambient": 0}
        state.classifications = clf

        # ── stress dropped below critical → reset ────────────────────────────
        if smoothed_stress <= self.STRESS_CRITICAL:
            if state.level > 0:
                print(f"✅  Bay {bay} stress normalised — escalation reset (was L{state.level})")
            state.reset()
            self._fatigue.note_recovery(bay)
            return None

        # ── stress is above critical ─────────────────────────────────────────
        if state.critical_since is None:
            state.critical_since = now
            return None  # just started — wait for INITIAL_DELAY_SECS

        elapsed = (now - state.critical_since).total_seconds()

        # ── nurse arrived → resolve and reset ────────────────────────────────
        if nurse_present and state.level >= 1:
            print(f"👩‍⚕️  Nurse detected at {bay} — resolving escalation (L{state.level})")
            state.reset()
            return None

        # ── determine if we should escalate ──────────────────────────────────
        target_level = 0

        if elapsed >= self.INITIAL_DELAY_SECS and state.level == 0:
            target_level = 1
        elif state.level >= 1 and state.level < 3:
            since_last = (now - state.level_changed_at).total_seconds() if state.level_changed_at else 0
            if since_last >= self.ESCALATION_DELAY:
                target_level = state.level + 1

        if target_level == 0:
            return None  # no transition needed

        # ── alarm fatigue check ──────────────────────────────────────────────
        fatigue = self._fatigue.check_and_consolidate(
            bay, "escalation", smoothed_stress
        )
        if fatigue and target_level == 1:
            # Consolidate repeated alerts instead of stacking
            alert_id = await self._fire_fatigue_alert(bay, smoothed_stress, fatigue)
            state.level = 1
            state.level_changed_at = now
            state.last_alert_id = alert_id
            return alert_id

        # ── fire escalation alert ────────────────────────────────────────────
        alert_id = await self._fire_alert(
            bay=bay,
            level=target_level,
            stress=smoothed_stress,
            elapsed=elapsed,
            clf=clf,
            db_level=db_level,
            state=state,
        )

        state.level = target_level
        state.level_changed_at = now
        state.last_alert_id = alert_id

        # ── trigger root cause analysis on Level 1 ───────────────────────────
        if target_level == 1:
            asyncio.create_task(self._run_root_cause(bay, smoothed_stress, clf))

        return alert_id

    # ── internal: fire an escalation alert ───────────────────────────────────

    async def _fire_alert(
        self,
        bay: str,
        level: int,
        stress: float,
        elapsed: float,
        clf: dict,
        db_level: float,
        state: _BayState,
    ) -> str:
        """Generate a Groq alert message and push it via alerts router."""
        # Lazy import to avoid circular dependency
        from routers.alerts import push_alert

        config = LEVEL_CONFIG[level]

        # Calculate time since Level 1 for higher levels
        since_l1 = elapsed  # total time in critical

        # Build the Groq user prompt
        user_prompt = config["prompt_tpl"].format(
            bay=bay,
            stress=stress,
            duration=elapsed,
            cry=clf.get("cry", 0),
            alarm=clf.get("alarm", 0),
            ambient=clf.get("ambient", 0),
            db=db_level,
            since_l1=since_l1,
        )

        # Call Groq for a natural-language alert body
        body = await self._call_groq(user_prompt)

        title = config["title_tpl"].format(bay=bay)

        alert = {
            "type":          AlertType.ESCALATION,
            "incubator_id":  bay,
            "title":         title,
            "body":          body,
            "severity":      config["severity"],
            "agent":         f"escalation_agent_L{level}",
            "escalation_level": level,
            "target":        config["target"],
            "stress_index":  stress,
            "classifications": clf,
        }

        alert_id = await push_alert(alert)
        print(f"🚨  Escalation L{level} fired for {bay} (stress={stress:.0f}, elapsed={elapsed:.0f}s)")
        return alert_id

    # ── internal: fire a fatigue-consolidated alert ──────────────────────────

    async def _fire_fatigue_alert(
        self, bay: str, stress: float, fatigue: dict
    ) -> str:
        """Push a consolidated alarm-fatigue alert instead of stacking."""
        from routers.alerts import push_alert

        alert = {
            "type":          AlertType.ALARM_FATIGUE,
            "incubator_id":  bay,
            "title":         f"⚡ Bay {bay} — Alarm Fatigue ({fatigue['count']}× in {fatigue['window_minutes']}min)",
            "body":          fatigue["message"],
            "severity":      "medium",
            "agent":         "escalation_agent_fatigue",
            "stress_index":  stress,
            "fatigue_count": fatigue["count"],
        }

        alert_id = await push_alert(alert)
        print(f"⚡  Alarm fatigue alert for {bay} ({fatigue['count']}× repeats)")
        return alert_id

    # ── internal: run root cause analysis in background ──────────────────────

    async def _run_root_cause(
        self, bay: str, stress: float, clf: dict
    ) -> None:
        """
        Trigger the RootCauseAgent after a Level 1 escalation.
        The hypothesis is pushed as a separate root_cause alert.
        """
        try:
            if self._root_cause_agent is None:
                from agents.root_cause_agent import RootCauseAgent
                self._root_cause_agent = RootCauseAgent()

            hypothesis = await self._root_cause_agent.run(bay, stress, clf)
            if hypothesis:
                from routers.alerts import push_alert
                await push_alert({
                    "type":          AlertType.ROOT_CAUSE,
                    "incubator_id":  bay,
                    "title":         f"🔍 Bay {bay} — Root Cause Analysis",
                    "body":          hypothesis,
                    "severity":      "medium",
                    "agent":         "root_cause_agent",
                    "stress_index":  stress,
                })
        except Exception as exc:
            print(f"⚠️  Root cause analysis failed for {bay}: {exc}")

    # ── Groq wrapper with graceful fallback ──────────────────────────────────

    async def _call_groq(self, user_prompt: str) -> str:
        """
        Call Groq for alert text. Falls back to a static message if
        the API key is missing or the call fails.
        """
        try:
            from utils.groq_client import chat
            return await chat(
                system=SYSTEM_PROMPT,
                user=user_prompt,
                max_tokens=200,
                temperature=0.3,
            )
        except RuntimeError as exc:
            # GROQ_API_KEY not set
            print(f"⚠️  Groq unavailable: {exc}")
            return (
                "AI analysis unavailable — API key not configured. "
                "Critical stress detected. Immediate bedside assessment recommended."
            )
        except Exception as exc:
            print(f"⚠️  Groq call failed: {exc}")
            return (
                "AI analysis temporarily unavailable. "
                "Critical stress detected. Please assess the infant immediately."
            )


# ── module-level singleton ───────────────────────────────────────────────────
# Imported by audio.py as:  from agents.escalation_agent import escalation_agent

escalation_agent = EscalationLoopAgent()
