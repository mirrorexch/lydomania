"""Phase 6c/6e — Roulette REST routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.config import ROULETTE_PRIZE_MODE
from core.db import items_col, roulette_baskets_col
from core.roulette_engine import (
    BET_TIERS, PHASE_DURATIONS_SEC, WHEEL_SIZE,
    derive_client_seed_combined, derive_item_pick, derive_segment_index,
    color_for_index, payout_multiplier, sha256_hex, wheel_layout,
)
from core.ton import static_url
from services.roulette import BetError, bets_col, engine, rounds_col


router = APIRouter(prefix="/api/roulette", tags=["roulette"])


class BetIn(BaseModel):
    round_id: str
    color: str = Field(..., pattern=r"^(red|black|green)$")
    amount_ton: float = Field(..., gt=0)


class BetOut(BaseModel):
    bet_id: str
    round_id: str
    color: str
    amount_ton: float
    balance_ton: float


@router.get("/config")
async def get_config() -> dict:
    """Static wheel config + bet tiers. Cacheable forever."""
    return {
        "wheel_size": WHEEL_SIZE,
        "wheel_layout": wheel_layout(),
        "payouts": {"red": payout_multiplier("red"),
                    "black": payout_multiplier("black"),
                    "green": payout_multiplier("green")},
        "phase_durations_sec": PHASE_DURATIONS_SEC,
        "bet_tiers": list(BET_TIERS),
        # Kept for legacy clients:
        "bet_min_ton": BET_TIERS[0],
        "bet_max_ton": BET_TIERS[-1],
        "prize_mode": ROULETTE_PRIZE_MODE,
    }


@router.get("/state")
async def get_state() -> dict:
    """Current round snapshot (for non-WS clients & reconnect)."""
    return engine.state_snapshot()


@router.post("/bet", response_model=BetOut)
async def place_bet(
    payload: BetIn = Body(...),
    user: dict = Depends(get_current_user),
) -> BetOut:
    try:
        res = await engine.place_bet(
            user=user,
            round_id=payload.round_id,
            color=payload.color,
            amount=float(payload.amount_ton),
        )
    except BetError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return BetOut(**res)


@router.get("/history")
async def history(limit: int = Query(20, ge=1, le=100)) -> dict:
    cur = rounds_col.find(
        {"server_seed": {"$exists": True}},
        {"_id": 0, "round_id": 1, "winning_color": 1, "segment_index": 1,
         "ended_at": 1, "total_pot_ton": 1, "total_payout_ton": 1,
         "total_basket_floor_ton": 1, "items_awarded": 1, "bet_count": 1,
         "prize_mode": 1},
    ).sort("ended_at", -1).limit(limit)
    rows = [doc async for doc in cur]
    return {"rows": rows}


@router.get("/my-bets")
async def my_bets(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    cur = bets_col.find(
        {"user_id": user["id"]}, {"_id": 0},
    ).sort("placed_at", -1).limit(limit)
    rows = [doc async for doc in cur]
    return {"rows": rows}


# ---- Phase 6e — gift basket preview --------------------------------------
@router.get("/baskets")
async def get_baskets() -> dict:
    """Public view of the 9 (tier × color) baskets so the UI can render the
    'this round you could win:' panel. Each entry returns the items with
    their floor prices + image URLs and the per-item draw probability."""
    baskets = [b async for b in roulette_baskets_col.find({}, {"_id": 0})]
    slugs: set[str] = set()
    for b in baskets:
        for it in b.get("items", []):
            slugs.add(it["item_slug"])
    item_meta: dict[str, dict] = {}
    async for d in items_col.find(
        {"slug": {"$in": list(slugs)}},
        {"_id": 0, "slug": 1, "name": 1, "image_path": 1, "floor_price_ton": 1, "rarity": 1},
    ):
        item_meta[d["slug"]] = d

    enriched: list[dict] = []
    for b in baskets:
        items = b.get("items", [])
        total_w = sum(float(i.get("weight") or 0.0) for i in items) or 1.0
        rendered = []
        for it in items:
            meta = item_meta.get(it["item_slug"], {})
            rendered.append({
                "item_slug": it["item_slug"],
                "item_name": meta.get("name", it["item_slug"]),
                "weight": float(it.get("weight") or 0.0),
                "draw_pct": round(100.0 * float(it.get("weight") or 0.0) / total_w, 3),
                "floor_ton": float(meta.get("floor_price_ton") or 0.0),
                "rarity": meta.get("rarity", "common"),
                "image_url": static_url(meta.get("image_path", f"items/{it['item_slug']}.png")),
            })
        rendered.sort(key=lambda x: x["floor_ton"], reverse=True)
        enriched.append({
            "id": b["id"],
            "tier": float(b["tier"]),
            "color": b["color"],
            "items": rendered,
            "expected_floor_ton": float(b.get("expected_floor_ton", 0.0)),
            "target_floor_ton": float(b.get("target_floor_ton", 0.0)),
        })
    enriched.sort(key=lambda x: (x["tier"], {"red": 0, "black": 1, "green": 2}[x["color"]]))
    return {"prize_mode": ROULETTE_PRIZE_MODE, "baskets": enriched}


@router.get("/rounds/{round_id}/verify")
async def verify_round(round_id: str = Path(..., min_length=4, max_length=64)) -> dict:
    """Provably-fair verifier. Reproduces segment_index from published seeds.
    Phase 6e: also reproduces every winning bet's item pick when prize_mode='gifts'.
    """
    doc = await rounds_col.find_one({"round_id": round_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "round not found")
    if not doc.get("server_seed"):
        raise HTTPException(409, "round not yet revealed")
    csc = derive_client_seed_combined(doc.get("bet_ids", []))
    recomputed_idx = derive_segment_index(doc["server_seed"], csc, round_id)
    recomputed_color = color_for_index(recomputed_idx)
    server_seed_hash_check = sha256_hex(doc["server_seed"])

    # Reproduce winning items
    item_recompute: list[dict] = []
    if doc.get("prize_mode", ROULETTE_PRIZE_MODE) == "gifts":
        winning_bets_cur = bets_col.find(
            {"round_id": round_id, "status": "won"}, {"_id": 0},
        )
        async for bet in winning_bets_cur:
            basket = await roulette_baskets_col.find_one(
                {"id": f"{int(bet['amount_ton'])}_{bet['color']}"}, {"_id": 0},
            )
            recomputed_slug = None
            if basket and basket.get("items"):
                pick = derive_item_pick(
                    doc["server_seed"], round_id, bet["bet_id"], basket["items"],
                )
                recomputed_slug = pick["item_slug"]
            item_recompute.append({
                "bet_id": bet["bet_id"],
                "amount_ton": float(bet["amount_ton"]),
                "color": bet["color"],
                "recorded_item_slug": bet.get("winning_item_slug"),
                "recomputed_item_slug": recomputed_slug,
                "matches": recomputed_slug == bet.get("winning_item_slug"),
            })

    return {
        "round_id": round_id,
        "ended_at": doc.get("ended_at"),
        "server_seed": doc["server_seed"],
        "server_seed_hash": doc.get("server_seed_hash"),
        "server_seed_hash_matches": server_seed_hash_check == doc.get("server_seed_hash"),
        "client_seed_combined": csc,
        "client_seed_combined_matches": csc == doc.get("client_seed_combined"),
        "segment_index": doc["segment_index"],
        "recomputed_segment_index": recomputed_idx,
        "segment_index_matches": recomputed_idx == doc["segment_index"],
        "winning_color": doc["winning_color"],
        "recomputed_color": recomputed_color,
        "bet_count": doc.get("bet_count", 0),
        "total_pot_ton": doc.get("total_pot_ton", 0.0),
        "total_payout_ton": doc.get("total_payout_ton", 0.0),
        "total_basket_floor_ton": doc.get("total_basket_floor_ton", 0.0),
        "prize_mode": doc.get("prize_mode", ROULETTE_PRIZE_MODE),
        "item_picks": item_recompute,
        "derivation_note": (
            "segment_index = HMAC_SHA256(server_seed, client_seed_combined || round_id)[:8] % 15; "
            "item_pick = weighted draw using HMAC_SHA256(server_seed, round_id|bet_id|item)[:8]/2^32 * Σw"
        ),
    }
