"""
routers/audio.py — NICU Guardian

Audio Pipeline WebSocket endpoints:
  /ws/audio  → browser sends 500ms audio analysis frames (microphone → YAMNet → backend)
  /ws/stress → backend broadcasts stress index to all dashboard subscribers

This router is the entry point for Feature 1 (Live Stress Index).
It also acts as the fusion point for Feature 8 (infant_motion_score from visual pipeline).
"""

import json
import asyncio
from datetime import datetime
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.stress_index import StressIndexAccumulator, compute_stress_index
from database.queries import insert_stress_event, insert_alert
from agents.escalation_agent import escalation_agent

router = APIRouter()

# ── shared state ──────────────────────────────────────────────────────────────

# Per-bay smoothing accumulators  {incubator_id: accumulator}
_accumulators: Dict[str, StressIndexAccumulator] = {}

# All connected /ws/stress dashboard subscribers
_subscribers: Set[WebSocket] = set()

# Per-bay motion score from visual pipeline (updated by visual router)
_motion_scores: Dict[str, float] = {}

# Per-bay cooldown for alarm-probability alerts (avoid spamming every 500ms)
_last_alarm_alert: Dict[str, datetime] = {}
ALARM_PROB_THRESHOLD = 0.60       # fire alert when alarm_prob exceeds this
ALARM_ALERT_COOLDOWN_SECS = 30    # don't re-alert same bay within this window


async def _fire_alarm_prob_alert(
    bay: str, alarm_prob: float, stress: float, clf: dict
) -> None:
    """Push an alert when alarm probability exceeds threshold (with cooldown)."""
    now = datetime.utcnow()
    last = _last_alarm_alert.get(bay)
    if last and (now - last).total_seconds() < ALARM_ALERT_COOLDOWN_SECS:
        return  # still in cooldown

    _last_alarm_alert[bay] = now

    from routers.alerts import push_alert
    from database.schemas import AlertType

    await push_alert({
        "type":          AlertType.ESCALATION,
        "incubator_id":  bay,
        "title":         f"🔔 Bay {bay} — High Alarm Detected ({alarm_prob:.0%})",
        "body":          (
            f"Equipment alarm probability has exceeded {ALARM_PROB_THRESHOLD:.0%} "
            f"(currently {alarm_prob:.0%}). "
            f"Current stress index: {stress:.0f}/100. "
            f"Audio breakdown — Cry: {clf.get('cry', 0):.0%}, "
            f"Alarm: {clf.get('alarm', 0):.0%}, "
            f"Ambient: {clf.get('ambient', 0):.0%}. "
            f"Please check equipment alarms at the bedside."
        ),
        "severity":      "high" if alarm_prob > 0.60 else "medium",
        "agent":         "audio_alarm_detector",
        "stress_index":  stress,
        "classifications": clf,
    })
    print(f"🔔  Alarm probability alert: {bay} — alarm={alarm_prob:.0%}")


# Per-bay cooldown for cry-probability alerts
_last_cry_alert: Dict[str, datetime] = {}
CRY_PROB_THRESHOLD = 0.60
CRY_ALERT_COOLDOWN_SECS = 30


async def _fire_cry_prob_alert(
    bay: str, cry_prob: float, stress: float, clf: dict
) -> None:
    """Push an alert when cry probability exceeds threshold (with cooldown)."""
    now = datetime.utcnow()
    last = _last_cry_alert.get(bay)
    if last and (now - last).total_seconds() < CRY_ALERT_COOLDOWN_SECS:
        return  # still in cooldown

    _last_cry_alert[bay] = now

    from routers.alerts import push_alert
    from database.schemas import AlertType

    await push_alert({
        "type":          AlertType.ESCALATION,
        "incubator_id":  bay,
        "title":         f"😢 Bay {bay} — Infant Crying Detected ({cry_prob:.0%})",
        "body":          (
            f"Infant cry probability has exceeded {CRY_PROB_THRESHOLD:.0%} "
            f"(currently {cry_prob:.0%}). "
            f"Current stress index: {stress:.0f}/100. "
            f"Audio breakdown — Cry: {clf.get('cry', 0):.0%}, "
            f"Alarm: {clf.get('alarm', 0):.0%}, "
            f"Ambient: {clf.get('ambient', 0):.0%}. "
            f"Immediate bedside assessment recommended."
        ),
        "severity":      "high" if cry_prob > 0.75 else "medium",
        "agent":         "audio_cry_detector",
        "stress_index":  stress,
        "classifications": clf,
    })
    print(f"😢  Cry probability alert: {bay} — cry={cry_prob:.0%}")


def get_accumulator(bay: str) -> StressIndexAccumulator:
    if bay not in _accumulators:
        _accumulators[bay] = StressIndexAccumulator(window=5)
    return _accumulators[bay]


async def broadcast(payload: dict) -> None:
    """Push a JSON payload to every connected stress subscriber."""
    dead: Set[WebSocket] = set()
    msg  = json.dumps(payload)
    for ws in _subscribers:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    _subscribers.difference_update(dead)


# ── public API for visual router ──────────────────────────────────────────────

def update_motion_score(bay: str, score: float) -> None:
    """Called by visual router to inject agitation score (Feature 8)."""
    _motion_scores[bay] = score


# ── WebSocket: /ws/audio (browser → backend) ─────────────────────────────────

@router.websocket("/ws/audio")
async def audio_ingest(ws: WebSocket) -> None:
    """
    Receives audio analysis frames from the browser every 500ms.

    Expected JSON schema (AudioFrame):
    {
      "type":               "audio_frame",
      "timestamp":          "2025-07-01T09:00:00.000Z",
      "incubator_id":       "BAY_03",
      "db_level":           72.4,
      "classifications":    { "cry": 0.81, "alarm": 0.12, "ambient": 0.07 },
      "mic_channels":       [72.4, 71.8, 73.1],
      "infant_motion_score": 0.62
    }
    """
    await ws.accept()
    bay = "UNKNOWN"
    print("🎙️  Audio WebSocket connected")

    try:
        while True:
            raw   = await ws.receive_text()
            frame = json.loads(raw)

            if frame.get("type") != "audio_frame":
                continue

            bay          = frame.get("incubator_id", "BAY_UNKNOWN")
            db_level     = float(frame.get("db_level", 50.0))
            clf          = frame.get("classifications", {})
            cry_prob     = float(clf.get("cry",     0.0))
            alarm_prob   = float(clf.get("alarm",   0.0))
            ambient_pen  = float(clf.get("ambient", 0.0))

            # Fuse with latest visual motion score (Feature 8)
            motion_score = _motion_scores.get(bay, float(frame.get("infant_motion_score", 0.0)))

            # Compute + smooth stress index
            raw_stress = compute_stress_index(db_level, cry_prob, alarm_prob, ambient_pen, motion_score)
            acc        = get_accumulator(bay)
            smoothed   = acc.push(raw_stress)
            trend      = acc.trend

            # ── Persist to MongoDB (non-blocking) ────────────────────────────
            event = {
                "timestamp":           datetime.utcnow(),
                "incubator_id":        bay,
                "stress_index":        smoothed,
                "db_level":            db_level,
                "cry_prob":            cry_prob,
                "alarm_prob":          alarm_prob,
                "ambient_penalty":     ambient_pen,
                "infant_motion_score": motion_score,
            }
            asyncio.create_task(insert_stress_event(event))

            # ── Broadcast to all /ws/stress subscribers ──────────────────────
            outbound = {
                "type":            "stress_update",
                "timestamp":       frame.get("timestamp"),
                "incubator_id":    bay,
                "stress_index":    smoothed,
                "trend":           trend,
                "db_level":        db_level,
                "classifications": clf,
                "motion_score":    motion_score,
            }
            asyncio.create_task(broadcast(outbound))

            # ── Feature 2: Escalation agent check ────────────────────────
            asyncio.create_task(
                escalation_agent.check(
                    bay=bay,
                    smoothed_stress=smoothed,
                    classifications=clf,
                    db_level=db_level,
                )
            )

            # ── Direct alarm-probability alert (fires when alarm > 60%) ───
            if alarm_prob > 0.60:
                asyncio.create_task(
                    _fire_alarm_prob_alert(bay, alarm_prob, smoothed, clf)
                )

            # ── Direct cry-probability alert (fires when cry > 60%) ───
            if cry_prob > 0.60:
                asyncio.create_task(
                    _fire_cry_prob_alert(bay, cry_prob, smoothed, clf)
                )

    except WebSocketDisconnect:
        print(f"🎙️  Audio WebSocket disconnected ({bay})")
    except Exception as exc:
        print(f"❌  Audio WebSocket error ({bay}): {exc}")
        try:
            await ws.close()
        except Exception:
            pass


# ── WebSocket: /ws/stress (backend → dashboard) ───────────────────────────────

@router.websocket("/ws/stress")
async def stress_subscribe(ws: WebSocket) -> None:
    """
    Dashboard subscribes here to receive live stress updates for all bays.
    Server pushes; client just listens (sends ping every 30s to stay alive).
    """
    await ws.accept()
    _subscribers.add(ws)
    print(f"📡  Stress subscriber connected  (total: {len(_subscribers)})")

    # Send immediate snapshot of current smoothed values
    snapshot = {
        "type": "snapshot",
        "bays": {
            bay: {"stress_index": acc.smoothed, "trend": acc.trend}
            for bay, acc in _accumulators.items()
        },
    }
    await ws.send_text(json.dumps(snapshot))

    try:
        while True:
            await asyncio.sleep(25)
            await ws.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _subscribers.discard(ws)
        print(f"📡  Stress subscriber left      (total: {len(_subscribers)})")
