"""
agents/occupancy_agent.py — NICU Guardian (Feature 7)
OccupancyAgent: Fires when person_count > threshold. Groq visitor management message.
TODO: implement in Phase 2/3/4
"""
from utils.groq_client import chat
from database.queries import get_stress_history, get_recent_alerts, get_occupancy_history

class OccupancyAgent:
    """Stub — full implementation in upcoming build phase."""
    async def run(self, bay: str) -> str | None:
        # TODO: implement
        raise NotImplementedError("OccupancyAgent not yet implemented")
