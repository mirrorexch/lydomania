"""Phase 8 — Achievements REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user
from services.achievements import (
    AchievementError, claim, list_all, list_for_user,
)

router = APIRouter(prefix="/api/achievements", tags=["achievements"])


class ClaimIn(BaseModel):
    achievement_id: str


@router.get("")
async def get_all(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    return {"rows": await list_all()}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)) -> dict:
    return {"rows": await list_for_user(user["id"])}


@router.post("/claim")
async def post_claim(payload: ClaimIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await claim(user["id"], payload.achievement_id)
    except AchievementError as e:
        raise HTTPException(status_code=400, detail=str(e))
