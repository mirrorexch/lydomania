"""Phase 6e — Admin endpoint to set the Roulette sell-back threshold."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field

from core.auth import get_admin_user
from core.config import ROULETTE_SELL_THRESHOLD_TON
from core.db import roulette_config_col
from core.time_utils import iso, now

router = APIRouter(prefix="/api/admin/roulette", tags=["admin", "roulette"])


class RouletteConfigOut(BaseModel):
    sell_threshold_ton: float
    updated_at: str | None = None


class RouletteConfigIn(BaseModel):
    sell_threshold_ton: float = Field(..., ge=0.0, le=1_000_000.0)


@router.get("/config", response_model=RouletteConfigOut)
async def get_roulette_config(_: dict = Depends(get_admin_user)) -> RouletteConfigOut:
    doc = await roulette_config_col.find_one({"id": "config"}, {"_id": 0})
    if not doc:
        return RouletteConfigOut(sell_threshold_ton=float(ROULETTE_SELL_THRESHOLD_TON))
    return RouletteConfigOut(
        sell_threshold_ton=float(doc.get("sell_threshold_ton", ROULETTE_SELL_THRESHOLD_TON)),
        updated_at=doc.get("updated_at"),
    )


@router.patch("/config", response_model=RouletteConfigOut)
async def update_roulette_config(
    payload: RouletteConfigIn = Body(...),
    admin: dict = Depends(get_admin_user),
) -> RouletteConfigOut:
    updated_at = iso(now())
    await roulette_config_col.update_one(
        {"id": "config"},
        {"$set": {
            "id": "config",
            "sell_threshold_ton": float(payload.sell_threshold_ton),
            "updated_at": updated_at,
            "updated_by_admin": int(admin.get("telegram_id") or 0),
        }},
        upsert=True,
    )
    return RouletteConfigOut(
        sell_threshold_ton=float(payload.sell_threshold_ton),
        updated_at=updated_at,
    )
