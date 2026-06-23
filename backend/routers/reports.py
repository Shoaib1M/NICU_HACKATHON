"""
routers/reports.py — NICU Guardian

  POST /shift-report   — trigger Shift Memory Agent
  GET  /parent-presence — get parent presence correlation stats
  GET  /shift-report    — get latest shift report
"""

from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks

from agents.shift_memory_agent import shift_memory_agent
from services.parent_presence import get_parent_presence_stats
from database.queries import get_latest_shift_report

router = APIRouter()

# Store the latest report in memory for quick retrieval
_latest_report: dict | None = None


async def _run_shift_report(hours: int) -> None:
    """Background task to generate the shift report."""
    global _latest_report
    try:
        report = await shift_memory_agent.generate(hours=hours)
        # Serialise datetime fields for JSON
        for key in ("shift_start", "shift_end", "generated_at", "peak_stress_time"):
            if isinstance(report.get(key), datetime):
                report[key] = report[key].isoformat()
        _latest_report = report
    except Exception as exc:
        print(f"❌  Shift report generation failed: {exc}")


@router.post("/shift-report")
async def generate_shift_report(
    background_tasks: BackgroundTasks,
    hours: int = 8,
):
    """Trigger the Shift Memory Agent to generate a report in the background."""
    end   = datetime.utcnow()
    start = end - timedelta(hours=hours)

    background_tasks.add_task(_run_shift_report, hours)

    return {
        "status":      "generating",
        "shift_start": start.isoformat(),
        "shift_end":   end.isoformat(),
        "message":     "Shift Memory Agent is running — poll GET /shift-report for the result.",
    }


@router.get("/shift-report")
async def get_shift_report():
    """Get the latest shift report (from memory or MongoDB)."""
    global _latest_report

    if _latest_report:
        return _latest_report

    # Try from MongoDB
    report = await get_latest_shift_report()
    if report:
        report["_id"] = str(report["_id"])
        for key in ("shift_start", "shift_end", "generated_at", "peak_stress_time"):
            if isinstance(report.get(key), datetime):
                report[key] = report[key].isoformat()
        return report

    return {"status": "no_report", "message": "No shift report available yet. POST /shift-report to generate one."}


@router.get("/parent-presence")
async def parent_presence(bay: str = "BAY_03", minutes: int = 480):
    """Get parent presence correlation statistics for a bay."""
    stats = await get_parent_presence_stats(bay, minutes)
    return stats
