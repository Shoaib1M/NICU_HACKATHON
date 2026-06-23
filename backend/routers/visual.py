"""
routers/visual.py — NICU Guardian

Visual Pipeline WebSocket endpoint:
  /ws/visual → browser sends 1-fps skeleton / occupancy frames

Receives visual_frame data from the CameraCapture component and:
  1. Pushes motion score to audio router for Feature 8 fusion
  2. Checks occupancy via occupancy agent (Feature 7)
  3. Tracks nurse response times (Feature 10)
  4. Persists occupancy logs to MongoDB
"""

import json
import asyncio
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from database.queries import insert_occupancy_log
from routers.audio import update_motion_score  # F8 fusion
from agents.occupancy_agent import occupancy_agent
from services.nurse_tracker import nurse_tracker

router = APIRouter()


@router.websocket("/ws/visual")
async def visual_ingest(ws: WebSocket):
    """
    Receives visual analysis frames from the browser every ~1 second.

    Expected JSON schema (VisualFrame):
    {
      "type":               "visual_frame",
      "timestamp":          "2025-07-01T09:00:00.000Z",
      "incubator_id":       "BAY_03",
      "person_count":       7,
      "nurse_present":      false,
      "infant_motion_score": 0.62,
      "skeleton_positions": [{"x": 0.4, "y": 0.6, "confidence": 0.9}]
    }
    """
    await ws.accept()
    bay = "UNKNOWN"
    print("📷  Visual WebSocket connected")

    try:
        while True:
            raw   = await ws.receive_text()
            frame = json.loads(raw)

            if frame.get("type") != "visual_frame":
                continue

            bay          = frame.get("incubator_id", "BAY_UNKNOWN")
            person_count = int(frame.get("person_count", 0))
            nurse        = bool(frame.get("nurse_present", False))
            motion       = float(frame.get("infant_motion_score", 0.0))

            # ── Feature 8: push motion score to audio router for fusion ──
            update_motion_score(bay, motion)

            # ── Feature 7: occupancy check (async, non-blocking) ─────────
            asyncio.create_task(occupancy_agent.check(bay, person_count))

            # ── Feature 10: nurse response tracking ──────────────────────
            if nurse and nurse_tracker.has_pending(bay):
                response_time = nurse_tracker.nurse_detected(bay)
                if response_time is not None:
                    print(f"✅  Nurse responded to {bay} in {response_time}s")

            # ── Persist occupancy log to MongoDB ─────────────────────────
            log = {
                "timestamp":      datetime.utcnow(),
                "incubator_id":   bay,
                "person_count":   person_count,
                "nurse_present":  nurse,
                "skeleton_count": len(frame.get("skeleton_positions", [])),
            }
            asyncio.create_task(insert_occupancy_log(log))

    except WebSocketDisconnect:
        print(f"📷  Visual WebSocket disconnected ({bay})")
    except Exception as exc:
        print(f"❌  Visual WebSocket error ({bay}): {exc}")
        try:
            await ws.close()
        except Exception:
            pass
