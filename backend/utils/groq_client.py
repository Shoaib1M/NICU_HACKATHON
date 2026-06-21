"""
utils/groq_client.py — NICU Guardian
Async Groq wrapper: llama-3.3-70b-versatile (30 RPM free tier).

Leave GROQ_API_KEY blank in .env during local dev —
the guards will warn you instead of crashing.
"""

import os
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

MODEL = "llama-3.3-70b-versatile"

_client: AsyncGroq | None = None


def get_groq_client() -> AsyncGroq:
    global _client
    if _client is None:
        key = os.getenv("GROQ_API_KEY", "").strip()
        if not key:
            raise RuntimeError(
                "GROQ_API_KEY is not set.\n"
                "Get a free key at https://console.groq.com and add it to backend/.env"
            )
        _client = AsyncGroq(api_key=key)
    return _client


async def chat(
    system:      str,
    user:        str,
    max_tokens:  int   = 512,
    temperature: float = 0.3,
) -> str:
    """Single-turn chat completion (used by escalation + shift memory agents)."""
    client = get_groq_client()
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return resp.choices[0].message.content.strip()


async def chat_with_tools(
    system:     str,
    user:       str,
    tools:      list,
    messages:   list | None = None,
    max_tokens: int = 512,
) -> object:
    """
    Chat with function-calling tools.
    Used by Root Cause Agent (F3) to query MongoDB tools.
    Returns the raw Choice object so callers can inspect tool_calls.
    """
    client = get_groq_client()
    msgs = messages or [
        {"role": "system", "content": system},
        {"role": "user",   "content": user},
    ]
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=msgs,
        tools=tools,
        tool_choice="auto",
        max_tokens=max_tokens,
    )
    return resp.choices[0]
