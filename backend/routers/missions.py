"""Phase 8 — Daily Missions REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user
from services.missions import MissionError, claim, get_or_create_daily

router = APIRouter(prefix="/api/missions", tags=["missions"])


class ClaimIn(BaseModel):
    mission_id: str


@router.get("/daily")
async def get_daily(user: dict = Depends(get_current_user)) -> dict:
    return await get_or_create_daily(user["id"])


@router.post("/claim")
async def post_claim(payload: ClaimIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await claim(user["id"], payload.mission_id)
    except MissionError as e:
        raise HTTPException(status_code=400, detail=str(e))
