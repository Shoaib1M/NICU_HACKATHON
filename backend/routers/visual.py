"""
routers/visual.py — NICU Guardian
Visual Pipeline WebSocket endpoints:
  /ws/visual → browser sends 1-fps skeleton / occupancy frames
  (implemented in Phase 2 — Visual Pipeline build)
"""
import json, asyncio
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from database.queries import insert_occupancy_log
from routers.audio import update_motion_score     # F8 fusion

router = APIRouter()
_subscribers = set()

@router.websocket("/ws/visual")
async def visual_ingest(ws: WebSocket):
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

            # Feature 8: push motion score to audio router for fusion
            update_motion_score(bay, motion)

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
