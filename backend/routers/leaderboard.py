"""Phase 4b — Public leaderboard routes."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import get_current_user
from services.leaderboard import VIEWS, PERIODS, get_leaderboard

router = APIRouter(prefix="/api")


@router.get("/leaderboard/{view}")
async def leaderboard(
    view: str,
    period: str = Query("week", pattern=r"^(week|all)$"),
    limit: int = Query(100, ge=1, le=500),
    user: Optional[dict] = Depends(get_current_user),
):
    if view not in VIEWS:
        raise HTTPException(status_code=400, detail=f"view must be one of {VIEWS}")
    if period not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {PERIODS}")
    return await get_leaderboard(view, period, limit=limit, current_user_id=user.get("id"))
