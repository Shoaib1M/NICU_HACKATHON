"""
services/stress_index.py — NICU Guardian

Core stress index formula (Feature 1) with visual fusion (Feature 8).

Formula:
  StressIndex = (0.4 × NormDB) + (0.35 × CryProb) + (0.15 × AlarmProb) + (0.1 × AmbientPenalty)

Visual fusion (F8 — Infant Agitation Detector):
  high motion + high cry  → ×1.15  (confirmed distress)
  low motion  + high cry  → ×0.85  (likely false positive — infant still but crying?)
"""

from __future__ import annotations
import numpy as np

# ── calibration constants ─────────────────────────────────────────────────────

DB_MIN: float = 20.0   # lowered for sensitivity — quieter sounds register higher
DB_MAX: float = 65.0   # lowered ceiling for demo/hackathon testing

W_DB:      float = 0.40
W_CRY:     float = 0.35
W_ALARM:   float = 0.15
W_AMBIENT: float = 0.10


# ── pure functions ────────────────────────────────────────────────────────────

def normalize_db(db_level: float) -> float:
    """Map raw dB level to [0, 1]."""
    clamped = max(DB_MIN, min(DB_MAX, db_level))
    return (clamped - DB_MIN) / (DB_MAX - DB_MIN)


def compute_stress_index(
    db_level:            float,
    cry_prob:            float,
    alarm_prob:          float,
    ambient_penalty:     float,
    infant_motion_score: float = 0.0,
) -> float:
    """
    Compute a single stress index value in [0, 100].

    Parameters
    ----------
    db_level            Raw dB level captured by the microphone.
    cry_prob            YAMNet / NICU classifier cry probability [0, 1].
    alarm_prob          YAMNet alarm/beep probability [0, 1].
    ambient_penalty     YAMNet ambient-noise contribution [0, 1].
    infant_motion_score Pixel-variance motion score from MotionDetector [0, 1].

    Returns
    -------
    float  Stress index in [0, 100], rounded to 2 d.p.
    """
    norm_db = normalize_db(db_level)

    base = (
        W_DB      * norm_db        +
        W_CRY     * cry_prob       +
        W_ALARM   * alarm_prob     +
        W_AMBIENT * ambient_penalty
    ) * 100.0

    # Feature 8 — visual fusion modifier
    if infant_motion_score >= 0.5 and cry_prob >= 0.5:
        fused = base * 1.15     # confirmed distress
    elif infant_motion_score < 0.2 and cry_prob >= 0.6:
        fused = base * 0.85     # low-confidence: infant still, but crying detected?
    else:
        fused = base

    return round(min(100.0, max(0.0, fused)), 2)


# ── stateful accumulator ─────────────────────────────────────────────────────

class StressIndexAccumulator:
    """
    Per-incubator rolling-window smoothing accumulator.
    One instance lives per bay; updated every 500ms from the audio router.
    """

    def __init__(self, window: int = 5) -> None:
        self.window = window
        self._buf: list[float] = []

    def push(self, value: float) -> float:
        """Add a new reading and return the smoothed value."""
        self._buf.append(value)
        if len(self._buf) > self.window:
            self._buf.pop(0)
        return self.smoothed

    @property
    def smoothed(self) -> float:
        if not self._buf:
            return 0.0
        return round(float(np.mean(self._buf)), 2)

    @property
    def trend(self) -> str:
        """'rising' | 'falling' | 'stable' based on delta across window."""
        if len(self._buf) < 3:
            return "stable"
        delta = self._buf[-1] - self._buf[0]
        if delta >  5:
            return "rising"
        if delta < -5:
            return "falling"
        return "stable"

    @property
    def last(self) -> float:
        return self._buf[-1] if self._buf else 0.0
