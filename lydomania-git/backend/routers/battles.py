"""Phase 6d — Case Battles REST routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.battles_engine import (
    HOUSE_RAKE_MAX_PCT, MAX_CASES_PER_BATTLE, MIN_CASES_PER_BATTLE,
    VALID_MODES, VALID_PLAYERS,
    derive_item_pick,
)
from services.battles import (
    BattleError, battles_col, create_battle, join_battle, leave_battle,
    public_battle, _load_cases,
)


router = APIRouter(prefix="/api/battles", tags=["battles"])


class CreateBattleIn(BaseModel):
    mode: str
    players: int = Field(..., ge=2, le=4)
    case_sequence: list[str] = Field(..., min_length=MIN_CASES_PER_BATTLE, max_length=MAX_CASES_PER_BATTLE)


@router.get("/config")
async def get_config() -> dict:
    return {
        "modes": list(VALID_MODES),
        "players_choices": list(VALID_PLAYERS),
        "case_sequence_min": MIN_CASES_PER_BATTLE,
        "case_sequence_max": MAX_CASES_PER_BATTLE,
        "house_rake_max_pct": HOUSE_RAKE_MAX_PCT,
    }


@router.get("")
async def list_battles(
    status: str = Query("open"),
    mode: str | None = Query(None),
    players: int | None = Query(None, ge=2, le=4),
    limit: int = Query(40, ge=1, le=100),
) -> dict:
    q: dict[str, Any] = {}
    if status != "any":
        # Accept comma-separated list
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        q["status"] = {"$in": statuses} if len(statuses) > 1 else statuses[0]
    if mode:
        q["mode"] = mode
    if players:
        q["players"] = int(players)
    sort_key = [("created_at", -1)]
    cur = battles_col.find(q, {"_id": 0}).sort(sort_key).limit(limit)
    rows = [public_battle(d, full=False) async for d in cur]
    return {"rows": rows}


@router.post("")
async def create_route(
    payload: CreateBattleIn = Body(...),
    user: dict = Depends(get_current_user),
) -> dict:
    try:
        return await create_battle(user, payload.mode, payload.players, payload.case_sequence)
    except BattleError as e:
        raise HTTPException(400, str(e))


@router.post("/{battle_id}/join")
async def join_route(
    battle_id: str = Path(..., min_length=4, max_length=64),
    user: dict = Depends(get_current_user),
) -> dict:
    try:
        return await join_battle(user, battle_id)
    except BattleError as e:
        msg = str(e)
        if msg == "battle_full":
            raise HTTPException(409, msg)
        if msg == "already_joined":
            raise HTTPException(409, msg)
        raise HTTPException(400, msg)


@router.post("/{battle_id}/leave")
async def leave_route(
    battle_id: str = Path(..., min_length=4, max_length=64),
    user: dict = Depends(get_current_user),
) -> dict:
    try:
        return await leave_battle(user, battle_id)
    except BattleError as e:
        raise HTTPException(400, str(e))


@router.get("/{battle_id}")
async def get_route(battle_id: str = Path(..., min_length=4, max_length=64)) -> dict:
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "battle not found")
    return public_battle(doc, full=True)


@router.get("/{battle_id}/verify")
async def verify_route(battle_id: str = Path(..., min_length=4, max_length=64)) -> dict:
    """Provably-fair audit: reveal seed + reproduce every (seat, round) pick."""
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "battle not found")
    if doc["status"] != "completed":
        raise HTTPException(409, "battle not yet completed")
    try:
        cases = await _load_cases(doc["case_sequence"])
    except BattleError as e:
        raise HTTPException(500, f"could not reload cases: {e}")
    server_seed = doc["server_seed"]
    seats = doc["seats"]
    reproduction: list[dict] = []
    for round_idx, case in enumerate(cases):
        basket = case.get("basket", [])
        for seat in seats:
            try:
                _, slug, payout, hex_h = derive_item_pick(
                    basket, server_seed, battle_id, round_idx, int(seat["seat_index"]),
                )
            except ValueError:
                slug, payout, hex_h = "", 0.0, ""
            recorded = next(
                (r for r in seat.get("rounds", []) if r.get("round_idx") == round_idx),
                None,
            )
            reproduction.append({
                "seat_index": int(seat["seat_index"]),
                "round_idx": round_idx,
                "case_slug": case.get("id"),
                "recomputed_slug": slug,
                "recomputed_payout_ton": payout,
                "recomputed_hmac_hex": hex_h,
                "recorded_slug": (recorded or {}).get("item_slug"),
                "recorded_payout_ton": (recorded or {}).get("payout_ton"),
                "matches": bool(recorded) and (recorded.get("item_slug") == slug),
            })
    all_match = all(r["matches"] for r in reproduction)
    import hashlib
    return {
        "battle_id": battle_id,
        "mode": doc["mode"],
        "players": int(doc["players"]),
        "server_seed": server_seed,
        "server_seed_hash": doc["server_seed_hash"],
        "server_seed_hash_matches": hashlib.sha256(server_seed.encode()).hexdigest()
            == doc["server_seed_hash"],
        "winner_seat_indices": doc.get("winner_seat_indices", []),
        "payout_per_winner_ton": doc.get("payout_per_winner_ton"),
        "rounds": reproduction,
        "all_picks_match": all_match,
        "derivation_note": (
            "for each (round_idx, seat_index): item = weighted_pick( case.basket, "
            "HMAC_SHA256(server_seed, f'{battle_id}|{round_idx}|{seat_index}') )"
        ),
    }
