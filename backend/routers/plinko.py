"""Phase 8 — Plinko REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.plinko_engine import PlinkoError, verify_drop
from services.plinko import config, get_bet, place_bet, user_history

router = APIRouter(prefix="/api/plinko", tags=["plinko"])


class BetIn(BaseModel):
    bet_ton: float = Field(..., gt=0)
    rows:    int   = Field(..., ge=4, le=20)
    risk:    str   = Field(..., pattern="^(low|medium|high)$")


@router.get("/config")
async def get_config(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    return config()


@router.post("/bet")
async def post_bet(payload: BetIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await place_bet(user["id"], payload.bet_ton, payload.rows, payload.risk)
    except PlinkoError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/bets/{bet_id}/verify")
async def get_verify(
    bet_id: str = Path(..., min_length=8, max_length=64),
    user: dict = Depends(get_current_user),  # noqa: ARG001
) -> dict:
    doc = await get_bet(bet_id)
    if not doc:
        raise HTTPException(status_code=404, detail="bet_not_found")
    v = verify_drop(
        doc["server_seed"], doc["server_seed_hash"], doc["client_seed"],
        doc["rows"], doc["risk"], doc["final_bucket"], doc["multiplier"],
    )
    return {
        "bet_id": bet_id,
        "server_seed": doc["server_seed"],
        "server_seed_hash": doc["server_seed_hash"],
        "client_seed": doc["client_seed"],
        "rows": doc["rows"], "risk": doc["risk"],
        "final_bucket": doc["final_bucket"], "multiplier": doc["multiplier"],
        "path": doc.get("path", []),
        "derivation_note": "path = HMAC-SHA256(server_seed, client_seed:0:0) → bit stream; bucket = sum(path); multiplier = MULTIPLIERS[(rows,risk)][bucket].",
        **v,
    }


@router.get("/history")
async def get_history(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    rows = await user_history(user["id"], limit=limit)
    return {"rows": rows}
