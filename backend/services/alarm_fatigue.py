"""
services/alarm_fatigue.py — NICU Guardian (Feature 5)
Detects when the same alarm type fires >3x in 10 min with no stress drop.
TODO: implement in Phase 3 (Alarm Fatigue build step)
"""
from collections import defaultdict
from datetime import datetime, timedelta

class AlarmFatigueDetector:
    """Track alarm frequency per bay. Returns True when fatigue is detected."""
    def __init__(self, threshold: int = 3, window_minutes: int = 10):
        self.threshold = threshold
        self.window    = timedelta(minutes=window_minutes)
        self._history: dict[str, list[datetime]] = defaultdict(list)

    def record(self, bay: str, alarm_type: str) -> bool:
        key = f"{bay}:{alarm_type}"
        now = datetime.utcnow()
        self._history[key] = [t for t in self._history[key] if now - t < self.window]
        self._history[key].append(now)
        return len(self._history[key]) >= self.threshold
