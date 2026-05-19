"""Phase 7c — Battle Pass / Seasons REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from services.season import (
    SeasonError, claim_tier, get_leaderboard, get_or_create_active_season,
    get_user_progress, hydrate_progress, unlock_premium,
)


router = APIRouter(prefix="/api/season", tags=["season"])


class ClaimIn(BaseModel):
    tier: int = Field(..., ge=1, le=30)
    track: str = Field(..., pattern="^(free|premium)$")


@router.get("/current")
async def get_current(user: dict = Depends(get_current_user)) -> dict:
    """Active season + this user's progress (hydrated with derived fields)."""
    season = await get_or_create_active_season()
    prog = await get_user_progress(user["id"], season["season_id"])
    return {
        "season": {
            "season_id":         season["season_id"],
            "name":              season.get("name"),
            "index":             season.get("index"),
            "started_at":        season["started_at"],
            "ends_at":           season["ends_at"],
            "status":            season["status"],
            "total_tiers":       season.get("total_tiers"),
            "premium_unlock_ton": season.get("premium_unlock_ton"),
            "tier_rewards":      season.get("tier_rewards", []),
            "seed_hash":         season.get("seed_hash"),
        },
        "progress": hydrate_progress(prog),
    }


@router.get("/rewards")
async def get_rewards(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001 — auth gate only
    """30-tier reward map for the active season — pure reward table.

    Useful when the client only needs the ladder (e.g. for a static admin
    preview) without the user's progress payload.
    """
    season = await get_or_create_active_season()
    return {
        "season_id": season["season_id"],
        "name": season.get("name"),
        "total_tiers": season.get("total_tiers"),
        "seed_hash": season.get("seed_hash"),
        "premium_unlock_ton": season.get("premium_unlock_ton"),
        "tier_rewards": season.get("tier_rewards", []),
    }


@router.post("/claim")
async def post_claim(
    payload: ClaimIn, user: dict = Depends(get_current_user),
) -> dict:
    season = await get_or_create_active_season()
    try:
        return await claim_tier(
            user_id=user["id"],
            season_id=season["season_id"],
            tier=int(payload.tier),
            track=payload.track,
        )
    except SeasonError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/unlock-premium")
async def post_unlock_premium(user: dict = Depends(get_current_user)) -> dict:
    season = await get_or_create_active_season()
    try:
        return await unlock_premium(
            user_id=user["id"], season_id=season["season_id"],
        )
    except SeasonError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/leaderboard")
async def get_season_leaderboard(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),  # noqa: ARG001 — auth gate only
) -> dict:
    season = await get_or_create_active_season()
    rows = await get_leaderboard(season["season_id"], limit=limit)
    return {
        "season_id": season["season_id"],
        "rows": rows,
    }
