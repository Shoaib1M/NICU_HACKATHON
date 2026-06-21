"""
database/mongo.py — NICU Guardian
Async MongoDB connection using Motor.
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


class _Database:
    client: AsyncIOMotorClient = None
    db = None


_state = _Database()


async def connect_db() -> None:
    uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/nicu_guardian")
    _state.client = AsyncIOMotorClient(uri)
    _state.db = _state.client["nicu_guardian"]

    # Create indexes for common queries
    await _state.db["stress_events"].create_index(
        [("incubator_id", 1), ("timestamp", -1)]
    )
    await _state.db["alerts"].create_index(
        [("incubator_id", 1), ("timestamp", -1)]
    )
    await _state.db["occupancy_logs"].create_index(
        [("incubator_id", 1), ("timestamp", -1)]
    )
    print(f"✅  MongoDB connected: {uri}")


async def close_db() -> None:
    if _state.client:
        _state.client.close()
        print("🔌  MongoDB disconnected")


def get_db():
    """Return the active database handle."""
    if _state.db is None:
        raise RuntimeError("Database not connected — call connect_db() first")
    return _state.db
