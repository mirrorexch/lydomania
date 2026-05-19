"""Phase 7a — Crash REST routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.crash_engine import (
    MAX_AUTO_CASHOUT_X, MAX_BET_TON, MIN_AUTO_CASHOUT_X, MIN_BET_TON,
    PHASE_DURATIONS_SEC, derive_client_seed_combined, derive_crash_multiplier, sha256_hex,
)
from services.crash import BetError, CashoutError, bets_col, engine, rounds_col


router = APIRouter(prefix="/api/crash", tags=["crash"])


class BetIn(BaseModel):
    amount_ton: float = Field(..., ge=MIN_BET_TON, le=MAX_BET_TON)
    auto_cashout_x: float | None = Field(
        None, ge=MIN_AUTO_CASHOUT_X, le=MAX_AUTO_CASHOUT_X,
    )


class BetOut(BaseModel):
    bet_id: str
    round_id: str
    amount_ton: float
    auto_cashout_x: float | None
    balance_ton: float


class CashoutIn(BaseModel):
    bet_id: str = Field(..., min_length=4, max_length=64)


class CashoutOut(BaseModel):
    bet_id: str
    cashed_at_x: float
    payout_ton: float
    balance_ton: float


@router.get("/config")
async def get_config() -> dict:
    return {
        "min_bet_ton": MIN_BET_TON,
        "max_bet_ton": MAX_BET_TON,
        "min_auto_x": MIN_AUTO_CASHOUT_X,
        "max_auto_x": MAX_AUTO_CASHOUT_X,
        "betting_duration_sec": PHASE_DURATIONS_SEC["betting"],
        "crashed_duration_sec": PHASE_DURATIONS_SEC["crashed"],
    }


@router.get("/state")
async def get_state() -> dict:
    return engine.state_snapshot()


@router.post("/bet", response_model=BetOut)
async def place_bet(
    payload: BetIn = Body(...),
    user: dict = Depends(get_current_user),
) -> BetOut:
    try:
        res = await engine.place_bet(
            user=user,
            amount=float(payload.amount_ton),
            auto_cashout_x=float(payload.auto_cashout_x) if payload.auto_cashout_x else None,
        )
    except BetError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return BetOut(**res)


@router.post("/cashout", response_model=CashoutOut)
async def cashout(
    payload: CashoutIn = Body(...),
    user: dict = Depends(get_current_user),
) -> CashoutOut:
    try:
        res = await engine.cashout(user=user, bet_id=payload.bet_id)
    except CashoutError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return CashoutOut(**res)


@router.get("/history")
async def history(limit: int = Query(30, ge=1, le=100)) -> dict:
    cur = rounds_col.find(
        {"crash_multiplier_revealed": {"$exists": True}},
        {"_id": 0, "round_id": 1, "crash_multiplier_revealed": 1, "ended_at": 1,
         "bet_count": 1, "total_wagered_ton": 1, "total_paid_ton": 1},
    ).sort("ended_at", -1).limit(limit)
    rows = [d async for d in cur]
    return {"rows": rows}


@router.get("/my-bets")
async def my_bets(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    cur = bets_col.find({"user_id": user["id"]}, {"_id": 0}).sort("placed_at", -1).limit(limit)
    rows = [d async for d in cur]
    return {"rows": rows}


@router.get("/rounds/{round_id}/verify")
async def verify_round(round_id: str = Path(..., min_length=4, max_length=64)) -> dict:
    doc = await rounds_col.find_one({"round_id": round_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "round not found")
    if not doc.get("server_seed"):
        raise HTTPException(409, "round not yet revealed")
    csc = derive_client_seed_combined(doc.get("bet_ids", []))
    recomputed = derive_crash_multiplier(doc["server_seed"], round_id, csc)
    seed_hash_check = sha256_hex(doc["server_seed"])
    return {
        "round_id": round_id,
        "ended_at": doc.get("ended_at"),
        "server_seed": doc["server_seed"],
        "server_seed_hash": doc.get("server_seed_hash"),
        "server_seed_hash_matches": seed_hash_check == doc.get("server_seed_hash"),
        "client_seed_combined": csc,
        "client_seed_combined_matches": csc == doc.get("client_seed_combined"),
        "crash_multiplier": doc["crash_multiplier_revealed"],
        "recomputed_crash_multiplier": recomputed,
        "crash_multiplier_matches": abs(recomputed - doc["crash_multiplier_revealed"]) < 1e-9,
        "bet_count": doc.get("bet_count", 0),
        "total_wagered_ton": doc.get("total_wagered_ton", 0.0),
        "total_paid_ton": doc.get("total_paid_ton", 0.0),
        "derivation_note": (
            "crash = bustabit formula: "
            "h = HMAC_SHA256(server_seed, round_id+':'+client_seed_combined); "
            "if int(h) % 33 == 0 → 1.00; "
            "else floor(100·(2^52)/(2^52 - int(h[:13],16)) - 99) / 100"
        ),
    }
