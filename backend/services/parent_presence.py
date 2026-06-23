"""
services/parent_presence.py — NICU Guardian (Feature 9)

Cross-references occupancy logs with stress events to determine:
  - When a non-clinical visitor (parent) was present during stress readings
  - The correlation between parent presence and stress reduction

Used by:
  - ParentPresenceChart.jsx (via REST endpoint)
  - ShiftMemoryAgent (for shift report statistics)
"""

from datetime import datetime, timedelta
from typing import List

from database.queries import get_occupancy_history, get_stress_history


async def tag_parent_presence(bay: str, stress_events: list) -> list:
    """
    Cross-reference stress events with occupancy logs.
    Tags each event with parent_present: bool.

    Heuristic: person_count > 1 AND nurse_present == False → parent visit.
    """
    occ_logs = await get_occupancy_history(bay, minutes=480)

    if not occ_logs:
        return [{**e, "parent_present": False} for e in stress_events]

    tagged = []
    for event in stress_events:
        ts = event["timestamp"]
        # Find closest occupancy reading within 30 seconds
        closest = min(
            occ_logs,
            key=lambda l: abs((l["timestamp"] - ts).total_seconds()),
            default=None,
        )
        parent = False
        if closest and abs((closest["timestamp"] - ts).total_seconds()) < 30:
            parent = closest["person_count"] > 1 and not closest.get("nurse_present", True)
        tagged.append({**e, "parent_present": parent})
    return tagged


async def get_parent_presence_stats(bay: str, minutes: int = 480) -> dict:
    """
    Compute parent presence correlation statistics for a bay.

    Returns:
    {
        "bay":                    str,
        "window_minutes":         int,
        "parent_present_readings": int,
        "parent_absent_readings":  int,
        "avg_stress_with_parent": float,
        "avg_stress_without":     float,
        "stress_reduction_pct":   float,
        "sessions": [
            { "start": ISO, "end": ISO, "duration_min": float, "avg_stress": float }
        ]
    }
    """
    stress_events = await get_stress_history(bay, minutes)
    if not stress_events:
        return {
            "bay": bay, "window_minutes": minutes,
            "parent_present_readings": 0, "parent_absent_readings": 0,
            "avg_stress_with_parent": 0, "avg_stress_without": 0,
            "stress_reduction_pct": 0, "sessions": [],
        }

    tagged = await tag_parent_presence(bay, stress_events)

    # Split into parent-present and parent-absent groups
    with_parent    = [e for e in tagged if e["parent_present"]]
    without_parent = [e for e in tagged if not e["parent_present"]]

    avg_with    = sum(e["stress_index"] for e in with_parent) / len(with_parent) if with_parent else 0
    avg_without = sum(e["stress_index"] for e in without_parent) / len(without_parent) if without_parent else 0

    # Stress reduction percentage
    reduction = 0.0
    if avg_without > 0 and avg_with < avg_without:
        reduction = round(((avg_without - avg_with) / avg_without) * 100, 1)

    # Identify parent visit sessions (consecutive parent-present readings)
    sessions = []
    current_session = None
    for event in tagged:
        if event["parent_present"]:
            if current_session is None:
                current_session = {
                    "start": event["timestamp"],
                    "readings": [event["stress_index"]],
                }
            else:
                current_session["readings"].append(event["stress_index"])
        else:
            if current_session:
                current_session["end"] = event["timestamp"]
                duration = (current_session["end"] - current_session["start"]).total_seconds() / 60
                sessions.append({
                    "start":        current_session["start"].isoformat(),
                    "end":          current_session["end"].isoformat(),
                    "duration_min": round(duration, 1),
                    "avg_stress":   round(sum(current_session["readings"]) / len(current_session["readings"]), 1),
                })
                current_session = None

    # Handle session still in progress
    if current_session and current_session["readings"]:
        sessions.append({
            "start":        current_session["start"].isoformat(),
            "end":          tagged[-1]["timestamp"].isoformat(),
            "duration_min": round(
                (tagged[-1]["timestamp"] - current_session["start"]).total_seconds() / 60, 1
            ),
            "avg_stress": round(sum(current_session["readings"]) / len(current_session["readings"]), 1),
        })

    return {
        "bay":                     bay,
        "window_minutes":          minutes,
        "parent_present_readings": len(with_parent),
        "parent_absent_readings":  len(without_parent),
        "avg_stress_with_parent":  round(avg_with, 1),
        "avg_stress_without":      round(avg_without, 1),
        "stress_reduction_pct":    reduction,
        "sessions":                sessions,
    }
