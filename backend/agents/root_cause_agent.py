"""
agents/root_cause_agent.py — NICU Guardian (Feature 3)

RootCauseAgent
━━━━━━━━━━━━━━
A Groq function-calling (tool-use) agent that investigates **why** stress
is elevated in a bay. It has access to three MongoDB query tools:

  1. query_stress_history  — recent stress readings + trends
  2. query_occupancy_log   — how many people are in the bay
  3. query_recent_alarms   — what alarms have fired recently

The agent loop runs up to 3 iterations:
  - Send prompt + tool definitions to Groq
  - If Groq requests tool calls → execute them → feed results back
  - When Groq returns a final text response → return the hypothesis

Output example:
  "Sustained cry (81%) combined with high occupancy (7 visitors)
   and a preceding SpO₂ alarm suggests a pain event, not equipment noise."

Triggered by:
  - EscalationLoopAgent._run_root_cause() after a Level 1 alert fires
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from database.queries import get_stress_history, get_occupancy_history, get_recent_alerts


# ── tool definitions (Groq function-calling schema) ──────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_stress_history",
            "description": (
                "Retrieve the stress index history for a specific incubator bay "
                "over the last N minutes. Returns timestamped stress readings, "
                "dB levels, and classification probabilities."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "bay": {
                        "type": "string",
                        "description": "Incubator bay ID, e.g. 'BAY_03'",
                    },
                    "minutes": {
                        "type": "integer",
                        "description": "How many minutes of history to retrieve (default 10)",
                        "default": 10,
                    },
                },
                "required": ["bay"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_occupancy_log",
            "description": (
                "Retrieve the occupancy (person count) history for a bay. "
                "Shows how many people were detected and whether a nurse was present."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "bay": {
                        "type": "string",
                        "description": "Incubator bay ID, e.g. 'BAY_03'",
                    },
                    "minutes": {
                        "type": "integer",
                        "description": "How many minutes of history (default 30)",
                        "default": 30,
                    },
                },
                "required": ["bay"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_recent_alarms",
            "description": (
                "Retrieve recent alerts/alarms for a bay. "
                "Shows alert types, severities, and whether they were resolved."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "bay": {
                        "type": "string",
                        "description": "Incubator bay ID, e.g. 'BAY_03'",
                    },
                    "minutes": {
                        "type": "integer",
                        "description": "How many minutes of history (default 30)",
                        "default": 30,
                    },
                },
                "required": ["bay"],
            },
        },
    },
]


# ── system prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the NICU Guardian Root Cause Analyst — an AI assistant for neonatal intensive care units.

Your role is to investigate WHY a bay's stress index is elevated by querying available data tools,
then synthesise a structured hypothesis.

You have access to three tools:
1. query_stress_history — stress readings, dB levels, cry/alarm probabilities over time
2. query_occupancy_log — person count and nurse presence over time
3. query_recent_alarms — recent alert documents

Analysis steps:
1. Query stress history to understand the trend (sudden spike vs gradual rise)
2. Check occupancy to see if overcrowding or lack of nurse presence correlates
3. Check recent alarms for equipment-related alerts (SpO₂, ventilator, etc.)
4. Synthesise your findings into a single-paragraph hypothesis (max 100 words)

Your hypothesis should:
- Identify the most likely root cause (infant distress, equipment alarm, environmental noise, visitor-related)
- Note any correlation between audio + visual + alarm data
- Suggest whether this is a true clinical event or a false positive
- Be written for a charge nurse audience — concise, clinical, actionable"""


# ── tool executor ────────────────────────────────────────────────────────────

async def _execute_tool(name: str, args: dict) -> str:
    """
    Execute a tool call from Groq against real MongoDB queries.
    Returns a JSON string summarising the results.
    """
    bay     = args.get("bay", "BAY_03")
    minutes = args.get("minutes", 10)

    if name == "query_stress_history":
        events = await get_stress_history(bay, minutes)
        if not events:
            return json.dumps({"result": "No stress data found for this bay in the given window."})

        # Summarise for the LLM (don't dump 2000 raw records)
        summary = []
        # Take at most 20 representative samples evenly spaced
        step = max(1, len(events) // 20)
        for e in events[::step]:
            summary.append({
                "time":    e["timestamp"].strftime("%H:%M:%S") if isinstance(e["timestamp"], datetime) else str(e["timestamp"]),
                "stress":  round(e.get("stress_index", 0), 1),
                "db":      round(e.get("db_level", 0), 1),
                "cry":     round(e.get("cry_prob", 0), 2),
                "alarm":   round(e.get("alarm_prob", 0), 2),
                "motion":  round(e.get("infant_motion_score", 0), 2),
            })

        avg_stress = sum(e.get("stress_index", 0) for e in events) / len(events)
        peak       = max(e.get("stress_index", 0) for e in events)

        return json.dumps({
            "bay": bay,
            "window_minutes": minutes,
            "total_readings": len(events),
            "avg_stress": round(avg_stress, 1),
            "peak_stress": round(peak, 1),
            "samples": summary,
        })

    elif name == "query_occupancy_log":
        logs = await get_occupancy_history(bay, minutes)
        if not logs:
            return json.dumps({"result": "No occupancy data found."})

        summary = []
        step = max(1, len(logs) // 10)
        for log in logs[::step]:
            summary.append({
                "time":          log["timestamp"].strftime("%H:%M:%S") if isinstance(log["timestamp"], datetime) else str(log["timestamp"]),
                "person_count":  log.get("person_count", 0),
                "nurse_present": log.get("nurse_present", False),
            })

        avg_count = sum(l.get("person_count", 0) for l in logs) / len(logs)

        return json.dumps({
            "bay": bay,
            "window_minutes": minutes,
            "total_snapshots": len(logs),
            "avg_person_count": round(avg_count, 1),
            "samples": summary,
        })

    elif name == "query_recent_alarms":
        alerts = await get_recent_alerts(bay, minutes)
        if not alerts:
            return json.dumps({"result": "No recent alarms found."})

        summary = []
        for a in alerts[:15]:  # max 15 recent
            summary.append({
                "time":     a["timestamp"].strftime("%H:%M:%S") if isinstance(a["timestamp"], datetime) else str(a["timestamp"]),
                "type":     a.get("type", "unknown"),
                "title":    a.get("title", ""),
                "severity": a.get("severity", "medium"),
                "resolved": a.get("resolved", False),
            })

        return json.dumps({
            "bay": bay,
            "window_minutes": minutes,
            "total_alerts": len(alerts),
            "alerts": summary,
        })

    else:
        return json.dumps({"error": f"Unknown tool: {name}"})


# ── agent class ──────────────────────────────────────────────────────────────

class RootCauseAgent:
    """
    Function-calling agent that diagnoses why stress is elevated.

    Usage:
        agent = RootCauseAgent()
        hypothesis = await agent.run("BAY_03", 82.5, {"cry": 0.81, "alarm": 0.12, "ambient": 0.07})
    """

    MAX_ITERATIONS = 3  # max tool-call loops before forcing a final answer

    async def run(
        self,
        bay: str,
        stress: float,
        classifications: dict,
    ) -> Optional[str]:
        """
        Investigate root cause of elevated stress.

        Returns a hypothesis string, or None if analysis fails.
        """
        user_prompt = (
            f"Bay {bay} has a critically elevated stress index of {stress:.0f}/100.\n"
            f"Audio classifications: Cry={classifications.get('cry', 0):.0%}, "
            f"Alarm={classifications.get('alarm', 0):.0%}, "
            f"Ambient={classifications.get('ambient', 0):.0%}.\n\n"
            f"Please investigate the root cause by querying the available tools, "
            f"then provide your hypothesis."
        )

        try:
            from utils.groq_client import chat_with_tools

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ]

            for iteration in range(self.MAX_ITERATIONS):
                choice = await chat_with_tools(
                    system="",  # already in messages
                    user="",
                    tools=TOOLS,
                    messages=messages,
                    max_tokens=512,
                )

                msg = choice.message

                # ── final text answer ────────────────────────────────────────
                if msg.content and not msg.tool_calls:
                    print(f"🔍  Root cause analysis complete for {bay} (iterations: {iteration + 1})")
                    return msg.content.strip()

                # ── tool calls requested ─────────────────────────────────────
                if msg.tool_calls:
                    # Add assistant message to conversation
                    messages.append({
                        "role":       "assistant",
                        "content":    msg.content or "",
                        "tool_calls": [
                            {
                                "id":       tc.id,
                                "type":     "function",
                                "function": {
                                    "name":      tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                            for tc in msg.tool_calls
                        ],
                    })

                    # Execute each tool call
                    for tc in msg.tool_calls:
                        func_name = tc.function.name
                        func_args = json.loads(tc.function.arguments)

                        print(f"   🔧  Tool call: {func_name}({func_args})")
                        result = await _execute_tool(func_name, func_args)

                        messages.append({
                            "role":         "tool",
                            "tool_call_id": tc.id,
                            "content":      result,
                        })

            # Exhausted iterations — ask for final answer
            messages.append({
                "role":    "user",
                "content": "Based on the data collected, provide your final root cause hypothesis now.",
            })
            choice = await chat_with_tools(
                system="", user="", tools=TOOLS,
                messages=messages, max_tokens=256,
            )
            return choice.message.content.strip() if choice.message.content else None

        except RuntimeError as exc:
            print(f"⚠️  Root cause agent — Groq unavailable: {exc}")
            return (
                "AI root cause analysis unavailable — API key not configured. "
                "Manual investigation recommended: check audio classifications, "
                "occupancy levels, and recent equipment alarms."
            )
        except Exception as exc:
            print(f"⚠️  Root cause agent error: {exc}")
            return None
