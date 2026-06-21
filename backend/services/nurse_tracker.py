"""
services/nurse_tracker.py — NICU Guardian (Feature 10)
Visually confirms nurse entered incubator bay after an alert and timestamps response.
TODO: implement in Phase 4 (Nurse Response Verifier build step)
"""
from datetime import datetime
from typing import Optional

class NurseResponseTracker:
    def __init__(self):
        self._pending: dict[str, datetime] = {}   # bay → alert timestamp

    def alert_raised(self, bay: str, at: datetime) -> None:
        self._pending[bay] = at

    def nurse_detected(self, bay: str) -> Optional[float]:
        """Returns response time in seconds if an alert was pending, else None."""
        if bay not in self._pending:
            return None
        elapsed = (datetime.utcnow() - self._pending.pop(bay)).total_seconds()
        return round(elapsed, 1)
