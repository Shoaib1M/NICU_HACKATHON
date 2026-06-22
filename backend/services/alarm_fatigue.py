"""
services/alarm_fatigue.py — NICU Guardian (Feature 5)

Detects alarm fatigue: when the same alarm type fires >3 times within
10 minutes without the stress index dropping below 40.

Instead of stacking repeated alert cards (which nurses learn to ignore),
fatigue-detected alarms are consolidated into a single amber card with
a repeat count and a probable-cause note.

Used by:
  - EscalationLoopAgent (before firing a new escalation alert)
  - Audio router (optional per-frame check)
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional


class AlarmFatigueDetector:
    """
    Track alarm frequency per bay.

    Parameters
    ----------
    threshold      : int   Number of alarms within the window to trigger fatigue.
    window_minutes : int   Sliding window size in minutes.
    """

    def __init__(self, threshold: int = 3, window_minutes: int = 10) -> None:
        self.threshold = threshold
        self.window    = timedelta(minutes=window_minutes)

        # {bay:alarm_type → [timestamp, ...]}
        self._history: dict[str, list[datetime]] = defaultdict(list)

        # {bay → last_stress_below_40_time}  — tracks recovery
        self._last_recovery: dict[str, datetime] = {}

    # ── core recording ───────────────────────────────────────────────────────

    def record(self, bay: str, alarm_type: str) -> bool:
        """
        Record an alarm occurrence and return True if fatigue threshold is met.
        """
        key = f"{bay}:{alarm_type}"
        now = datetime.utcnow()

        # Prune entries outside the sliding window
        self._history[key] = [
            t for t in self._history[key] if now - t < self.window
        ]
        self._history[key].append(now)

        return len(self._history[key]) >= self.threshold

    def note_recovery(self, bay: str) -> None:
        """Called when a bay's stress drops below 40 — resets fatigue tracking."""
        self._last_recovery[bay] = datetime.utcnow()

    # ── enhanced fatigue check ───────────────────────────────────────────────

    def check_and_consolidate(
        self,
        bay: str,
        alarm_type: str,
        current_stress: float,
    ) -> Optional[dict]:
        """
        Record an alarm and check for fatigue.

        Returns a fatigue alert payload dict if fatigue is detected AND the
        stress has not recovered below 40 since the first alarm in the window.
        Returns None otherwise (meaning the caller should fire a normal alert).

        Parameters
        ----------
        bay            : str    Incubator bay ID (e.g. "BAY_03")
        alarm_type     : str    The alarm type string (e.g. "escalation")
        current_stress : float  Current smoothed stress index

        Returns
        -------
        dict | None
            If fatigue detected:
            {
                "fatigue": True,
                "count": int,
                "window_minutes": int,
                "bay": str,
                "alarm_type": str,
                "message": str,
            }
        """
        # Track stress recovery
        if current_stress < 40:
            self.note_recovery(bay)

        # Record the alarm and check threshold
        is_fatigued = self.record(bay, alarm_type)

        if not is_fatigued:
            return None

        # Check if stress has recovered below 40 since the window started
        key = f"{bay}:{alarm_type}"
        window_start = self._history[key][0]
        last_recovery = self._last_recovery.get(bay)

        if last_recovery and last_recovery > window_start:
            # Stress did drop below 40 during this window — not true fatigue
            return None

        count = len(self._history[key])
        return {
            "fatigue":        True,
            "count":          count,
            "window_minutes": int(self.window.total_seconds() / 60),
            "bay":            bay,
            "alarm_type":     alarm_type,
            "message": (
                f"Alarm fatigue detected: {alarm_type} has fired {count}× "
                f"in the last {int(self.window.total_seconds() / 60)} minutes "
                f"without stress recovery below 40. "
                f"Possible cause: sensor drift or persistent environmental noise. "
                f"Consolidating into a single notification."
            ),
        }

    def get_count(self, bay: str, alarm_type: str) -> int:
        """Return the current alarm count within the sliding window."""
        key = f"{bay}:{alarm_type}"
        now = datetime.utcnow()
        self._history[key] = [
            t for t in self._history[key] if now - t < self.window
        ]
        return len(self._history[key])

    def clear(self, bay: str) -> None:
        """Clear all fatigue history for a bay (e.g. on manual reset)."""
        keys_to_remove = [k for k in self._history if k.startswith(f"{bay}:")]
        for k in keys_to_remove:
            del self._history[k]
        self._last_recovery.pop(bay, None)
