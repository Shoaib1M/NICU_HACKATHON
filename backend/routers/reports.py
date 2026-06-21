"""
routers/reports.py — NICU Guardian
  POST /shift-report — trigger Shift Memory Agent (F-Shift, Phase 4)
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks

router = APIRouter()

@router.post("/shift-report")
async def generate_shift_report(background_tasks: BackgroundTasks,
                                hours: int = 8):
    # TODO: wire up shift_memory_agent in Phase 4
    end   = datetime.utcnow()
    start = end - timedelta(hours=hours)
    return {
        "status":      "queued",
        "shift_start": start.isoformat(),
        "shift_end":   end.isoformat(),
        "message":     "Shift Memory Agent will run in background — implement in Phase 4",
    }
