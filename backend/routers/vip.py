"""Phase 9 — VIP REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from services.vip import (
    TIERS, VipError, already_claimed_today, claim_rakeback, get_vip_state,
)

router = APIRouter(prefix="/api/vip", tags=["vip"])


@router.get("/tiers")
async def get_tiers(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    return {"tiers": TIERS}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)) -> dict:
    state = await get_vip_state(user["id"])
    state["already_claimed_today"] = await already_claimed_today(user["id"])
    return state


@router.post("/claim-rakeback")
async def post_claim_rakeback(user: dict = Depends(get_current_user)) -> dict:
    try:
        return await claim_rakeback(user["id"])
    except VipError as e:
        raise HTTPException(status_code=400, detail=str(e))
