"""
agents/shift_memory_agent.py — NICU Guardian (Feature S)

ShiftMemoryAgent
━━━━━━━━━━━━━━━━
Triggered via POST /shift-report. Queries all 5 MongoDB collections
for the past 8 hours and generates a narrative shift report:

  - Peak stress period and value
  - Alarm fatigue events count
  - Average nurse response time
  - Parent session count and stress reduction percentage
  - Total alerts raised vs resolved
  - Groq-generated natural-language narrative

The report is displayed in an expandable accordion on the dashboard.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from database.queries import (
    get_stress_history,
    get_shift_alerts,
    get_occupancy_history,
    insert_shift_report,
)
from services.parent_presence import get_parent_presence_stats
from services.nurse_tracker import nurse_tracker


# ── Groq prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the NICU Guardian Shift Memory system. You generate concise,
clinical shift handover reports for charge nurses.

Write a narrative summary (150–200 words) covering:
1. Overall ward status during the shift
2. Peak stress events and likely causes
3. Alarm fatigue incidents
4. Nurse response performance
5. Parent visit impact on infant stress
6. Key recommendations for the incoming shift

Use professional clinical language. Be factual and data-driven.
Format with clear paragraphs. Do not use bullet points."""

USER_PROMPT_TPL = """\
Generate a shift report for the past {hours} hours ({start} to {end}).

Data summary:
- Total stress readings: {total_readings}
- Peak stress: {peak_stress}/100 at {peak_time} in {peak_bay}
- Average stress across all bays: {avg_stress}/100
- Total alerts raised: {total_alerts}
- Alerts resolved: {resolved_alerts}
- Alarm fatigue events: {fatigue_count}
- Average nurse response time: {avg_response}s ({response_count} responses)
- Parent visit sessions: {parent_sessions}
- Stress reduction during parent visits: {stress_reduction}%

Please write the shift narrative now."""


# ── agent class ──────────────────────────────────────────────────────────────

class ShiftMemoryAgent:
    """
    Queries MongoDB collections and generates a narrative shift report via Groq.

    Usage:
        agent = ShiftMemoryAgent()
        report = await agent.generate(hours=8)
    """

    async def generate(self, hours: int = 8) -> dict:
        """
        Generate a complete shift report.

        Returns the full ShiftReport dict ready for MongoDB storage and display.
        """
        end   = datetime.utcnow()
        start = end - timedelta(hours=hours)

        # ── Gather data from all collections ─────────────────────────────
        # Stress data (we query all known bays)
        bays = ["BAY_01", "BAY_02", "BAY_03", "BAY_04", "BAY_05", "BAY_06"]

        all_stress = []
        for bay in bays:
            events = await get_stress_history(bay, minutes=hours * 60)
            all_stress.extend(events)

        # Sort by timestamp
        all_stress.sort(key=lambda e: e.get("timestamp", datetime.min))

        # Alerts
        all_alerts = await get_shift_alerts(start, end)
        total_alerts   = len(all_alerts)
        resolved_alerts = sum(1 for a in all_alerts if a.get("resolved", False))
        fatigue_count   = sum(1 for a in all_alerts if a.get("type") == "alarm_fatigue")

        # Peak stress
        peak_stress = 0
        peak_bay    = "N/A"
        peak_time   = start
        if all_stress:
            peak_event  = max(all_stress, key=lambda e: e.get("stress_index", 0))
            peak_stress = round(peak_event.get("stress_index", 0), 1)
            peak_bay    = peak_event.get("incubator_id", "N/A")
            peak_time   = peak_event.get("timestamp", start)

        # Average stress
        avg_stress = 0
        if all_stress:
            avg_stress = round(sum(e.get("stress_index", 0) for e in all_stress) / len(all_stress), 1)

        # Nurse response stats
        avg_response   = nurse_tracker.get_avg_response_time(minutes=hours * 60)
        response_count = nurse_tracker.get_response_count(minutes=hours * 60)

        # Parent presence stats (use BAY_03 as primary, but ideally aggregate)
        parent_stats = await get_parent_presence_stats("BAY_03", minutes=hours * 60)
        parent_sessions  = len(parent_stats.get("sessions", []))
        stress_reduction = parent_stats.get("stress_reduction_pct", 0)

        # ── Generate narrative via Groq ──────────────────────────────────
        narrative = await self._generate_narrative(
            hours=hours,
            start=start.strftime("%H:%M"),
            end=end.strftime("%H:%M"),
            total_readings=len(all_stress),
            peak_stress=peak_stress,
            peak_time=peak_time.strftime("%H:%M") if isinstance(peak_time, datetime) else str(peak_time),
            peak_bay=peak_bay,
            avg_stress=avg_stress,
            total_alerts=total_alerts,
            resolved_alerts=resolved_alerts,
            fatigue_count=fatigue_count,
            avg_response=avg_response,
            response_count=response_count,
            parent_sessions=parent_sessions,
            stress_reduction=stress_reduction,
        )

        # ── Build report document ────────────────────────────────────────
        report = {
            "shift_start":              start,
            "shift_end":                end,
            "generated_at":             datetime.utcnow(),
            "narrative":                narrative,
            "peak_stress":              peak_stress,
            "peak_stress_bay":          peak_bay,
            "peak_stress_time":         peak_time,
            "alarm_fatigue_count":      fatigue_count,
            "avg_nurse_response_secs":  avg_response,
            "parent_sessions":          parent_sessions,
            "avg_stress_reduction_pct": stress_reduction,
            "total_alerts":             total_alerts,
            "resolved_alerts":          resolved_alerts,
        }

        # Persist to MongoDB
        report_id = await insert_shift_report(report)
        report["_id"] = report_id

        print(f"📋  Shift report generated ({hours}h window, {len(all_stress)} readings)")
        return report

    async def _generate_narrative(self, **kwargs) -> str:
        """Generate the narrative via Groq with graceful fallback."""
        user_prompt = USER_PROMPT_TPL.format(**kwargs)

        try:
            from utils.groq_client import chat
            return await chat(
                system=SYSTEM_PROMPT,
                user=user_prompt,
                max_tokens=500,
                temperature=0.4,
            )
        except RuntimeError:
            return self._fallback_narrative(**kwargs)
        except Exception as exc:
            print(f"⚠️  Groq shift report failed: {exc}")
            return self._fallback_narrative(**kwargs)

    def _fallback_narrative(self, **kwargs) -> str:
        """Static fallback narrative when Groq is unavailable."""
        return (
            f"Shift Summary ({kwargs.get('start', '?')} – {kwargs.get('end', '?')})\n\n"
            f"During this {kwargs.get('hours', 8)}-hour shift, "
            f"{kwargs.get('total_readings', 0)} stress readings were recorded. "
            f"Peak stress reached {kwargs.get('peak_stress', 0)}/100 in "
            f"{kwargs.get('peak_bay', 'N/A')} at {kwargs.get('peak_time', 'N/A')}. "
            f"Average stress across all bays was {kwargs.get('avg_stress', 0)}/100.\n\n"
            f"A total of {kwargs.get('total_alerts', 0)} alerts were raised, "
            f"of which {kwargs.get('resolved_alerts', 0)} were resolved. "
            f"{kwargs.get('fatigue_count', 0)} alarm fatigue events were detected.\n\n"
            f"Nurse response: {kwargs.get('response_count', 0)} responses recorded "
            f"with an average time of {kwargs.get('avg_response', 0)}s. "
            f"{kwargs.get('parent_sessions', 0)} parent visit sessions were identified, "
            f"showing a {kwargs.get('stress_reduction', 0)}% stress reduction during visits.\n\n"
            f"(AI narrative unavailable — API key not configured.)"
        )


# ── module-level singleton ───────────────────────────────────────────────────

shift_memory_agent = ShiftMemoryAgent()
