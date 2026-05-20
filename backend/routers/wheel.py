"""Phase 7b — Wheel of Fortune REST routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.db import items_col
from core.ton import static_url
from core.wheel_engine import (
    FREE_TOKEN_REFRESH_SEC, PAID_SPIN_COST_TON, SEGMENT_COUNT,
    derive_segment, sha256_hex,
)
from services.wheel import (
    WheelError, get_segments, maybe_refresh_free_token,
    next_free_token_at, spin, spins_col,
)


router = APIRouter(prefix="/api/wheel", tags=["wheel"])


class SpinIn(BaseModel):
    use_free_token: bool = Field(False)


class SpinOut(BaseModel):
    spin_id: str
    segment_index: int
    segment_type: str
    payout_type: str
    payout_ton: float
    payout_item_slug: str | None = None
    inventory_id: str | None = None
    new_balance: float
    new_token_count: int
    next_free_token_at: str | None = None
    server_seed_hash: str
    payout_value_ton_est: float


@router.get("/config")
async def get_config(user: dict = Depends(get_current_user)) -> dict:
    # Auto-grant a token if 24h has elapsed since last grant. Idempotent under
    # concurrent calls (Mongo CAS-style conditional update).
    snap = await maybe_refresh_free_token(user["id"])

    # Hydrate each gift-segment with the item's name + image + floor so the
    # frontend can render a clean legend without extra API calls.
    segments = await get_segments()
    slugs = [s["item_slug"] for s in segments if s.get("item_slug")]
    item_lookup = {}
    if slugs:
        cur = items_col.find(
            {"slug": {"$in": slugs}},
            {"_id": 0, "slug": 1, "name": 1, "image_path": 1, "rarity": 1, "floor_price_ton": 1},
        )
        item_lookup = {d["slug"]: d async for d in cur}
    enriched = []
    for s in segments:
        slug = s.get("item_slug")
        info = item_lookup.get(slug, {}) if slug else {}
        enriched.append({
            "segment_index": int(s["segment_index"]),
            "segment_type": s["segment_type"],
            "multiplier": s.get("multiplier"),
            "item_slug": slug,
            "item_name": info.get("name"),
            "item_rarity": info.get("rarity"),
            "item_floor_ton": float(info.get("floor_price_ton") or 0.0) if slug else None,
            # Phase 11.2.3 — wrap image_path in static_url() so the frontend
            # receives a fully absolute "/api/static/items/<slug>.png" URL
            # (the items collection stores the relative path "items/<slug>.png"
            # only).  Without this the wheel LegendCard rendered <img> tags
            # whose src was https://<origin>/items/<slug>.png → 404, which
            # showed up as broken-icon placeholders in the "What you can win"
            # row under the wheel.
            "image_path": (
                static_url(info["image_path"])
                if slug and info.get("image_path")
                else None
            ),
            "weight": int(s["weight"]),
        })

    return {
        "segment_count": SEGMENT_COUNT,
        "segments": enriched,
        "paid_spin_cost_ton": PAID_SPIN_COST_TON,
        "free_token_refresh_sec": FREE_TOKEN_REFRESH_SEC,
        "free_spin_tokens": snap["free_spin_tokens"],
        "next_free_token_at": next_free_token_at(snap.get("last_free_token_at")),
    }


@router.post("/spin", response_model=SpinOut)
async def post_spin(
    payload: SpinIn = Body(default_factory=SpinIn),
    user: dict = Depends(get_current_user),
) -> SpinOut:
    try:
        res = await spin(user, use_free_token=payload.use_free_token)
    except WheelError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SpinOut(
        spin_id=res["spin_id"],
        segment_index=int(res["segment_index"]),
        segment_type=res["segment_type"],
        payout_type=res["payout_type"],
        payout_ton=float(res["payout_ton"]),
        payout_item_slug=res.get("payout_item_slug"),
        inventory_id=res.get("inventory_id"),
        new_balance=float(res["new_balance"]),
        new_token_count=int(res["new_token_count"]),
        next_free_token_at=res.get("next_free_token_at"),
        server_seed_hash=res["server_seed_hash"],
        payout_value_ton_est=float(res["payout_value_ton_est"]),
    )


@router.get("/history")
async def my_history(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    cur = spins_col.find(
        {"user_id": user["id"]},
        {"_id": 0, "server_seed": 0},      # don't leak un-revealed seeds (all are revealed but keep payload light)
    ).sort("spun_at", -1).limit(limit)
    rows = [d async for d in cur]
    return {"rows": rows}


@router.get("/spins/{spin_id}/verify")
async def verify_spin(spin_id: str = Path(..., min_length=4, max_length=64)) -> dict:
    doc = await spins_col.find_one({"spin_id": spin_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "spin not found")
    segs = await get_segments()
    recomputed = derive_segment(doc["server_seed"], spin_id, segs)
    seed_hash_check = sha256_hex(doc["server_seed"])
    return {
        "spin_id": spin_id,
        "spun_at": doc.get("spun_at"),
        "server_seed": doc["server_seed"],
        "server_seed_hash": doc["server_seed_hash"],
        "server_seed_hash_matches": seed_hash_check == doc["server_seed_hash"],
        "segment_index": doc["segment_index"],
        "recomputed_segment_index": recomputed,
        "segment_index_matches": recomputed == doc["segment_index"],
        "payout_type": doc["payout_type"],
        "payout_ton": doc["payout_ton"],
        "payout_item_slug": doc.get("payout_item_slug"),
        "derivation_note": (
            "segment_index = HMAC_SHA256(server_seed, spin_id) walked over "
            "cumulative weights of the 24-segment table."
        ),
    }
