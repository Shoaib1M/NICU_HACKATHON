"""
services/parent_presence.py — NICU Guardian (Feature 9)
Tags stress events with parent-presence boolean from occupancy log.
TODO: implement in Phase 4 (Parent Presence Chart build step)
"""
from datetime import datetime, timedelta
from database.queries import get_occupancy_history

async def tag_parent_presence(bay: str, stress_events: list) -> list:
    """
    Cross-reference stress events with occupancy logs.
    Tags each event with parent_present: bool.
    (Simple heuristic: person_count > 1 && outside nurse shifts → parent)
    """
    occ_logs = await get_occupancy_history(bay, minutes=480)
    tagged   = []
    for event in stress_events:
        ts = event["timestamp"]
        # Find closest occupancy reading within 30s
        closest = min(occ_logs, key=lambda l: abs((l["timestamp"] - ts).total_seconds()), default=None)
        parent  = False
        if closest and abs((closest["timestamp"] - ts).total_seconds()) < 30:
            parent = closest["person_count"] > 1 and not closest["nurse_present"]
        tagged.append({**event, "parent_present": parent})
    return tagged
