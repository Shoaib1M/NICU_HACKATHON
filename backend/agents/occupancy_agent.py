"""
agents/occupancy_agent.py — NICU Guardian (Feature 7)

OccupancyAgent
━━━━━━━━━━━━━━
Fires when person_count exceeds the NICU guideline maximum (6 visitors).
Uses Groq to generate a polite, professional message suggesting
non-essential visitors step outside.

Called by the visual router on every /ws/visual frame.
Deduplicates: won't fire again for the same bay within 5 minutes.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Optional

from database.schemas import AlertType


# ── constants ────────────────────────────────────────────────────────────────

MAX_OCCUPANCY    = 6     # NICU guideline maximum
DEDUP_MINUTES    = 5     # don't re-alert same bay within this window

SYSTEM_PROMPT = """\
You are the NICU Guardian occupancy management system in a neonatal intensive care unit.
Generate polite, professional messages for nursing staff when visitor counts exceed safe limits.
Keep messages under 50 words. Be respectful of families while prioritising infant safety."""

USER_PROMPT_TPL = """\
Bay {bay} currently has {count} people detected, exceeding the NICU guideline maximum of {max}.
Generate a brief, polite notification for the nurse station suggesting non-essential visitors
step outside to maintain a calm environment for the infant."""


# ── agent class ──────────────────────────────────────────────────────────────

class OccupancyAgent:
    """
    Checks occupancy levels and fires alerts when overcrowded.

    Usage:
        agent = OccupancyAgent()
        await agent.check("BAY_03", 8)  # fires alert if > 6 and not deduped
    """

    def __init__(self) -> None:
        self._last_alert: Dict[str, datetime] = {}

    async def check(self, bay: str, person_count: int) -> Optional[str]:
        """
        Called by the visual router on every frame.

        Returns alert_id if an alert was fired, else None.
        """
        if person_count <= MAX_OCCUPANCY:
            return None

        # Deduplication check
        now = datetime.utcnow()
        last = self._last_alert.get(bay)
        if last and (now - last).total_seconds() < DEDUP_MINUTES * 60:
            return None

        # Fire alert
        alert_id = await self._fire_alert(bay, person_count)
        self._last_alert[bay] = now
        return alert_id

    async def _fire_alert(self, bay: str, count: int) -> str:
        """Generate a Groq occupancy message and push it."""
        from routers.alerts import push_alert

        body = await self._call_groq(bay, count)

        alert = {
            "type":          AlertType.OCCUPANCY,
            "incubator_id":  bay,
            "title":         f"👥 Bay {bay} — Overcrowded ({count} people)",
            "body":          body,
            "severity":      "medium",
            "agent":         "occupancy_agent",
            "person_count":  count,
        }

        alert_id = await push_alert(alert)
        print(f"👥  Occupancy alert: {bay} has {count} people (max {MAX_OCCUPANCY})")
        return alert_id

    async def _call_groq(self, bay: str, count: int) -> str:
        """Call Groq for occupancy message with graceful fallback."""
        try:
            from utils.groq_client import chat
            return await chat(
                system=SYSTEM_PROMPT,
                user=USER_PROMPT_TPL.format(bay=bay, count=count, max=MAX_OCCUPANCY),
                max_tokens=100,
                temperature=0.3,
            )
        except RuntimeError:
            return (
                f"Bay {bay} has {count} visitors, exceeding the NICU maximum of {MAX_OCCUPANCY}. "
                f"Please kindly ask non-essential visitors to step outside "
                f"to maintain a calm environment for the infant."
            )
        except Exception as exc:
            print(f"⚠️  Groq occupancy call failed: {exc}")
            return (
                f"Occupancy alert: {count} people detected in {bay} "
                f"(guideline max: {MAX_OCCUPANCY}). Please manage visitor flow."
            )


# ── module-level singleton ───────────────────────────────────────────────────

occupancy_agent = OccupancyAgent()
