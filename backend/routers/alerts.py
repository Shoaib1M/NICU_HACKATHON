"""
routers/alerts.py — NICU Guardian
  GET  /alerts          — list recent alerts
  POST /alerts/{id}/resolve — mark resolved
  WS   /ws/alerts       — push new alerts to dashboard (implemented in Phase 2)
"""
from fastapi import APIRouter, HTTPException
from database.queries import get_recent_alerts, resolve_alert

router = APIRouter()

@router.get("/alerts")
async def list_alerts(bay: str = "BAY_03", minutes: int = 60):
    docs = await get_recent_alerts(bay, minutes)
    for d in docs:
        d["_id"] = str(d["_id"])
        d["timestamp"] = d["timestamp"].isoformat()
    return docs

@router.post("/alerts/{alert_id}/resolve")
async def resolve(alert_id: str):
    ok = await resolve_alert(alert_id)
    if not ok:
        raise HTTPException(404, "Alert not found")
    return {"resolved": True}
