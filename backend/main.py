"""
NICU Guardian — FastAPI Backend
Samsung Solve for Tomorrow Hackathon 2025 | NIT Rourkela

Run:  uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.mongo import connect_db, close_db
from routers import audio, visual, alerts, reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title="NICU Guardian API",
    description="Real-time AI neonatal ward monitoring — audio + visual pipelines",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audio.router,   tags=["audio"])
app.include_router(visual.router,  tags=["visual"])
app.include_router(alerts.router,  tags=["alerts"])
app.include_router(reports.router, tags=["reports"])


@app.get("/")
async def root():
    return {"status": "NICU Guardian API running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
