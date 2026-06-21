"""
agents/root_cause_agent.py — NICU Guardian (Feature 3)
RootCauseAgent: Function-calling agent: query_stress_history | query_occupancy_log | query_recent_alarms
TODO: implement in Phase 2/3/4
"""
from utils.groq_client import chat
from database.queries import get_stress_history, get_recent_alerts, get_occupancy_history

class RootCauseAgent:
    """Stub — full implementation in upcoming build phase."""
    async def run(self, bay: str) -> str | None:
        # TODO: implement
        raise NotImplementedError("RootCauseAgent not yet implemented")
