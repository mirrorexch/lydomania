"""Phase 9 — Marketplace REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from services.marketplace import (
    FEE_BPS_DEFAULT, LISTING_TTL_DAYS, MAX_PRICE_TON, MIN_PRICE_TON,
    MarketError, browse, buy_listing, cancel_listing, list_item, my_listings,
    total_fees_collected,
)
from services.vip import marketplace_fee_discount_bps

router = APIRouter(prefix="/api/marketplace", tags=["marketplace"])


@router.get("/config")
async def get_config(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    """Public bounds + default fee bps. Used by Inventory "List on Market"
    price modal to surface min/max inline (Fix-F)."""
    return {
        "min_price_ton": MIN_PRICE_TON,
        "max_price_ton": MAX_PRICE_TON,
        "fee_bps_default": FEE_BPS_DEFAULT,
        "listing_ttl_days": LISTING_TTL_DAYS,
    }


class ListIn(BaseModel):
    inventory_item_id: str
    price_ton: float = Field(..., gt=0)


class BuyIn(BaseModel):
    listing_id: str


class CancelIn(BaseModel):
    listing_id: str


@router.get("")
async def get_browse(
    item_template_id: str | None = Query(None, alias="item_template_id"),
    min_price: float | None = Query(None, ge=0),
    max_price: float | None = Query(None, ge=0),
    sort: str = Query("recent", pattern="^(recent|price_asc|price_desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),  # noqa: ARG001
) -> dict:
    return await browse(item_slug=item_template_id, min_price=min_price,
                        max_price=max_price, sort=sort, page=page, page_size=page_size)


@router.post("/list")
async def post_list(payload: ListIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await list_item(user["id"], payload.inventory_item_id, payload.price_ton)
    except MarketError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cancel")
async def post_cancel(payload: CancelIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await cancel_listing(user["id"], payload.listing_id)
    except MarketError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/buy")
async def post_buy(payload: BuyIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        bps = await marketplace_fee_discount_bps(user["id"])
        return await buy_listing(user["id"], payload.listing_id, vip_fee_discount_bps=bps)
    except MarketError as e:
        msg = str(e)
        if msg == "listing_not_found":
            code = 404
        elif msg in ("already_sold", "cancelled", "expired", "not_active"):
            code = 409
        else:
            code = 400
        raise HTTPException(status_code=code, detail=msg)


@router.get("/my")
async def get_my(user: dict = Depends(get_current_user)) -> dict:
    return await my_listings(user["id"])


@router.get("/fees")
async def get_fees(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    return {"total_fees_ton": await total_fees_collected()}
