"""
database/schemas.py — NICU Guardian
Pydantic v2 models for all 5 MongoDB collections.

Collections:
  stress_events   — F1 live stress readings (every 500ms)
  occupancy_logs  — F7 visual person-count snapshots
  alerts          — F2,3,4,5,7 agent-generated alert documents
  incubator_map   — bay layout + mic channel assignments
  shift_reports   — F(Shift) end-of-shift memory agent output
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ── stress_events ─────────────────────────────────────────────────────────────

class StressEvent(BaseModel):
    timestamp:           datetime
    incubator_id:        str
    stress_index:        float        # 0–100
    db_level:            float        # raw dB, 30–90
    cry_prob:            float        # 0–1
    alarm_prob:          float        # 0–1
    ambient_penalty:     float        # 0–1
    infant_motion_score: float = 0.0  # 0–1, from visual pipeline (F8)


# ── occupancy_logs ────────────────────────────────────────────────────────────

class OccupancyLog(BaseModel):
    timestamp:      datetime
    incubator_id:   str
    person_count:   int
    nurse_present:  bool
    skeleton_count: int = 0           # MediaPipe skeleton detections


# ── alerts ────────────────────────────────────────────────────────────────────

class AlertType:
    ESCALATION   = "escalation"
    ROOT_CAUSE   = "root_cause"
    ALARM_FATIGUE = "alarm_fatigue"
    OCCUPANCY    = "occupancy"
    PREDICTION   = "prediction"

class AlertDoc(BaseModel):
    timestamp:    datetime
    type:         str               # AlertType constant
    incubator_id: str
    title:        str
    body:         str
    severity:     str = "medium"    # low | medium | high
    resolved:     bool = False
    resolved_at:  Optional[datetime] = None
    agent:        Optional[str] = None   # which agent generated this


# ── incubator_map ─────────────────────────────────────────────────────────────

class IncubatorMapEntry(BaseModel):
    incubator_id:  str
    bay_name:      str
    row:           int               # 0-indexed grid position
    col:           int
    mic_channels:  List[int]         # TDOA channel indices
    mic_positions: List[List[float]] # [[x,y,z], ...] in metres


# ── shift_reports ─────────────────────────────────────────────────────────────

class ShiftReport(BaseModel):
    shift_start:               datetime
    shift_end:                 datetime
    generated_at:              datetime
    narrative:                 str          # Groq-generated prose
    peak_stress:               float
    peak_stress_bay:           str
    peak_stress_time:          datetime
    alarm_fatigue_count:       int
    avg_nurse_response_secs:   float
    parent_sessions:           int
    avg_stress_reduction_pct:  float
    total_alerts:              int
    resolved_alerts:           int


# ── WebSocket frame schemas (not stored, used for validation) ─────────────────

class AudioFrame(BaseModel):
    """Incoming frame from browser /ws/audio every 500ms."""
    type:                 str = "audio_frame"
    timestamp:            str
    incubator_id:         str
    db_level:             float
    classifications:      dict          # {cry, alarm, ambient}
    mic_channels:         List[float]   # per-mic dB readings (for TDOA)
    infant_motion_score:  float = 0.0

class VisualFrame(BaseModel):
    """Incoming frame from browser /ws/visual every 1s."""
    type:               str = "visual_frame"
    timestamp:          str
    incubator_id:       str
    person_count:       int
    nurse_present:      bool
    infant_motion_score: float
    skeleton_positions: List[dict]      # [{x,y,z,confidence}, ...]
