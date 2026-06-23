"""
services/nurse_tracker.py — NICU Guardian (Feature 10)

Tracks nurse response times after escalation alerts.
When the visual pipeline detects a nurse entering the bay zone,
this service records the response time and persists it to MongoDB.

Used by:
  - visual router: calls nurse_detected() when nurse_present == True
  - escalation agent: calls alert_raised() when firing an escalation
  - shift memory agent: queries average response times for the shift report
"""

from datetime import datetime
from typing import Optional, Dict, List




class NurseResponseTracker:
    """
    Per-bay nurse response time tracker.

    Flow:
      1. Escalation agent fires → alert_raised(bay, timestamp)
      2. Visual pipeline detects nurse → nurse_detected(bay)
      3. Response time is calculated and stored
    """

    def __init__(self) -> None:
        # {bay → alert_timestamp} for pending (unanswered) escalations
        self._pending: Dict[str, datetime] = {}
        # All recorded response times: [(bay, response_secs, timestamp)]
        self._history: List[dict] = []

    def alert_raised(self, bay: str, at: Optional[datetime] = None) -> None:
        """Called when an escalation alert fires for a bay."""
        self._pending[bay] = at or datetime.utcnow()
        print(f"⏱️  Nurse timer started for {bay}")

    def nurse_detected(self, bay: str) -> Optional[float]:
        """
        Called when the visual pipeline detects a nurse in the bay.
        Returns response time in seconds if an alert was pending, else None.
        """
        if bay not in self._pending:
            return None

        alert_time = self._pending.pop(bay)
        elapsed = (datetime.utcnow() - alert_time).total_seconds()
        response_secs = round(elapsed, 1)

        # Record in history
        self._history.append({
            "bay":            bay,
            "response_secs":  response_secs,
            "timestamp":      datetime.utcnow(),
        })

        print(f"👩‍⚕️  Nurse response: {bay} in {response_secs}s")
        return response_secs

    def has_pending(self, bay: str) -> bool:
        """Check if there's a pending (unanswered) escalation for a bay."""
        return bay in self._pending

    def get_avg_response_time(self, minutes: int = 480) -> float:
        """
        Average response time over the given window (default 8 hours / 1 shift).
        Returns 0.0 if no data.
        """
        if not self._history:
            return 0.0

        cutoff = datetime.utcnow()
        from datetime import timedelta
        cutoff -= timedelta(minutes=minutes)

        recent = [h["response_secs"] for h in self._history if h["timestamp"] >= cutoff]
        if not recent:
            return 0.0

        return round(sum(recent) / len(recent), 1)

    def get_response_count(self, minutes: int = 480) -> int:
        """Number of nurse responses recorded in the window."""
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(minutes=minutes)
        return sum(1 for h in self._history if h["timestamp"] >= cutoff)


# ── module-level singleton ───────────────────────────────────────────────────

nurse_tracker = NurseResponseTracker()
