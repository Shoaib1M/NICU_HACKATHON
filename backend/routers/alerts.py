"""
routers/alerts.py — NICU Guardian

Alert management + real-time push to dashboard:
  GET  /alerts              — list recent alerts (REST)
  POST /alerts/{id}/resolve — mark an alert resolved
  WS   /ws/alerts           — push new alerts to all connected dashboards

The ``push_alert()`` function is the **single entry point** used by every
agent (escalation, root cause, prediction, occupancy) to:
  1. Persist the alert to MongoDB
  2. Broadcast it to all /ws/alerts subscribers in real time
"""

import json
import asyncio
from datetime import datetime
from typing import Set

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from database.queries import insert_alert, get_recent_alerts, resolve_alert

router = APIRouter()

# ── WebSocket subscriber pool ────────────────────────────────────────────────

_alert_subscribers: Set[WebSocket] = set()


async def push_alert(alert: dict) -> str:
    """
    Persist an alert to MongoDB and broadcast it to all /ws/alerts subscribers.

    Parameters
    ----------
    alert : dict
        Must contain at minimum:
          - type        : str   (AlertType constant — escalation / root_cause / prediction / etc.)
          - incubator_id: str
          - title       : str
          - body        : str
          - severity    : str   (low / medium / high)
        Optional:
          - agent       : str   (which agent generated this)
          - resolved    : bool  (default False)

    Returns
    -------
    str  The inserted MongoDB document _id.
    """
    # Ensure timestamp is always set
    alert.setdefault("timestamp", datetime.utcnow())
    alert.setdefault("resolved", False)
    alert.setdefault("resolved_at", None)

    # Persist to MongoDB
    alert_id = await insert_alert(alert)

    # Build the outbound payload for WebSocket subscribers
    outbound = {
        **alert,
        "_id": alert_id,
        "timestamp": alert["timestamp"].isoformat()
            if isinstance(alert["timestamp"], datetime)
            else str(alert["timestamp"]),
    }

    # Broadcast to all connected dashboards
    dead: Set[WebSocket] = set()
    msg = json.dumps(outbound)
    for ws in _alert_subscribers:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    _alert_subscribers.difference_update(dead)

    bay = alert.get("incubator_id", "?")
    severity = alert.get("severity", "medium")
    print(f"🚨  Alert pushed [{severity}] {alert.get('title', '')} — {bay}")

    return alert_id


# ── REST endpoints ────────────────────────────────────────────────────────────

@router.get("/alerts")
async def list_alerts(bay: str = "BAY_03", minutes: int = 60):
    """Return recent alerts for a bay."""
    docs = await get_recent_alerts(bay, minutes)
    for d in docs:
        d["_id"] = str(d["_id"])
        d["timestamp"] = d["timestamp"].isoformat()
        if d.get("resolved_at"):
            d["resolved_at"] = d["resolved_at"].isoformat()
    return docs


@router.post("/alerts/{alert_id}/resolve")
async def resolve(alert_id: str):
    """Mark an alert as resolved."""
    ok = await resolve_alert(alert_id)
    if not ok:
        raise HTTPException(404, "Alert not found")
    return {"resolved": True}


@router.post("/alerts/test")
async def test_alert(bay: str = "BAY_03"):
    """
    Fire a sample alert through the full pipeline (MongoDB + WebSocket broadcast).
    Useful for verifying the alert system works during demos.
    """
    from database.schemas import AlertType

    alert = {
        "type":          AlertType.ESCALATION,
        "incubator_id":  bay,
        "title":         f"⚠️ Bay {bay} — Test Alert",
        "body":          (
            f"This is a test alert for {bay}. "
            "The alert system is working correctly. "
            "Stress index simulated at 78/100 with elevated cry probability. "
            "This alert was triggered manually for verification purposes."
        ),
        "severity":      "high",
        "agent":         "test_manual",
        "stress_index":  78.0,
        "classifications": {"cry": 0.72, "alarm": 0.15, "ambient": 0.13},
    }

    alert_id = await push_alert(alert)
    return {"alert_id": alert_id, "status": "Test alert pushed successfully"}


# ── WebSocket: /ws/alerts (backend → dashboard) ──────────────────────────────

@router.websocket("/ws/alerts")
async def alerts_subscribe(ws: WebSocket) -> None:
    """
    Dashboard subscribes here to receive real-time agent alerts.
    Server pushes; client just listens.
    A ping is sent every 25s to keep the connection alive.
    """
    await ws.accept()
    _alert_subscribers.add(ws)
    print(f"📡  Alert subscriber connected   (total: {len(_alert_subscribers)})")

    try:
        while True:
            # Keep-alive ping every 25 seconds
            await asyncio.sleep(25)
            await ws.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _alert_subscribers.discard(ws)
        print(f"📡  Alert subscriber left        (total: {len(_alert_subscribers)})")
