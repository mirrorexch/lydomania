"""Phase 7c — Admin Seasons routes."""
from __future__ import annotations

from typing import Any

from fastapi import Body, HTTPException, Path

from core.db import db
from routers.admin import admin
from services.season import (
    SeasonError, force_end_season, get_or_create_active_season,
    patch_tier_rewards,
)


seasons_col = db["seasons"]


@admin.get("/seasons")
async def admin_list_seasons() -> list[dict[str, Any]]:
    """All seasons (active + frozen), newest first."""
    out: list[dict[str, Any]] = []
    async for d in seasons_col.find({}, {"_id": 0}).sort("started_at", -1):
        out.append(d)
    return out


@admin.get("/seasons/current")
async def admin_get_current_season() -> dict:
    return await get_or_create_active_season()


@admin.post("/seasons/{season_id}/force-end")
async def admin_force_end_season(
    season_id: str = Path(..., min_length=3, max_length=64),
) -> dict:
    try:
        return await force_end_season(season_id)
    except SeasonError as e:
        raise HTTPException(status_code=400, detail=str(e))


@admin.patch("/seasons/{season_id}/rewards")
async def admin_patch_season_rewards(
    season_id: str = Path(..., min_length=3, max_length=64),
    payload: list[dict] = Body(...),
) -> dict:
    """Patch upcoming tier rewards. Tiers already claimed by any user are frozen."""
    try:
        return await patch_tier_rewards(season_id, payload)
    except SeasonError as e:
        raise HTTPException(status_code=400, detail=str(e))
