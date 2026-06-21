"""
database/queries.py — NICU Guardian
Async query helpers used by agents and routers.
"""

from datetime import datetime, timedelta
from typing import List, Optional
from bson import ObjectId

from database.mongo import get_db


# ── stress_events ─────────────────────────────────────────────────────────────

async def insert_stress_event(event: dict) -> str:
    db  = get_db()
    res = await db["stress_events"].insert_one(event)
    return str(res.inserted_id)


async def get_stress_history(incubator_id: str, minutes: int = 10) -> List[dict]:
    db    = get_db()
    since = datetime.utcnow() - timedelta(minutes=minutes)
    cur   = db["stress_events"].find(
        {"incubator_id": incubator_id, "timestamp": {"$gte": since}},
        sort=[("timestamp", 1)],
    )
    return await cur.to_list(length=2000)


async def get_avg_stress(incubator_id: str, minutes: int = 5) -> float:
    events = await get_stress_history(incubator_id, minutes)
    if not events:
        return 0.0
    return round(sum(e["stress_index"] for e in events) / len(events), 2)


# ── alerts ────────────────────────────────────────────────────────────────────

async def insert_alert(alert: dict) -> str:
    db  = get_db()
    res = await db["alerts"].insert_one(alert)
    return str(res.inserted_id)


async def get_recent_alerts(incubator_id: str, minutes: int = 10) -> List[dict]:
    db    = get_db()
    since = datetime.utcnow() - timedelta(minutes=minutes)
    cur   = db["alerts"].find(
        {"incubator_id": incubator_id, "timestamp": {"$gte": since}},
        sort=[("timestamp", -1)],
    )
    return await cur.to_list(length=50)


async def resolve_alert(alert_id: str) -> bool:
    db  = get_db()
    res = await db["alerts"].update_one(
        {"_id": ObjectId(alert_id)},
        {"$set": {"resolved": True, "resolved_at": datetime.utcnow()}},
    )
    return res.modified_count == 1


async def get_shift_alerts(start: datetime, end: datetime) -> List[dict]:
    db  = get_db()
    cur = db["alerts"].find(
        {"timestamp": {"$gte": start, "$lte": end}},
        sort=[("timestamp", 1)],
    )
    return await cur.to_list(length=500)


# ── occupancy_logs ────────────────────────────────────────────────────────────

async def insert_occupancy_log(log: dict) -> str:
    db  = get_db()
    res = await db["occupancy_logs"].insert_one(log)
    return str(res.inserted_id)


async def get_occupancy_history(incubator_id: str, minutes: int = 60) -> List[dict]:
    db    = get_db()
    since = datetime.utcnow() - timedelta(minutes=minutes)
    cur   = db["occupancy_logs"].find(
        {"incubator_id": incubator_id, "timestamp": {"$gte": since}},
        sort=[("timestamp", -1)],
    )
    return await cur.to_list(length=200)


# ── shift_reports ─────────────────────────────────────────────────────────────

async def insert_shift_report(report: dict) -> str:
    db  = get_db()
    res = await db["shift_reports"].insert_one(report)
    return str(res.inserted_id)


async def get_latest_shift_report() -> Optional[dict]:
    db  = get_db()
    return await db["shift_reports"].find_one(sort=[("generated_at", -1)])
