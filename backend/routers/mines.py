"""Phase 8 — Mines REST routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from core.auth import get_current_user
from core.mines_engine import GRID_SIZE, MINES_MAX, MINES_MIN, verify_layout
from services.mines import (
    MinesError, active_game, cashout, get_game, reveal_cell, start_game,
    user_history,
)

router = APIRouter(prefix="/api/mines", tags=["mines"])


class StartIn(BaseModel):
    bet_ton: float = Field(..., gt=0)
    mines_count: int = Field(..., ge=MINES_MIN, le=MINES_MAX)


class RevealIn(BaseModel):
    game_id: str
    cell: int = Field(..., ge=0, lt=GRID_SIZE)


class CashoutIn(BaseModel):
    game_id: str


@router.get("/config")
async def get_config(user: dict = Depends(get_current_user)) -> dict:  # noqa: ARG001
    return {
        "grid_size": GRID_SIZE,
        "mines_min": MINES_MIN, "mines_max": MINES_MAX,
        "min_bet_ton": 0.1, "max_bet_ton": 100.0,
    }


@router.get("/active")
async def get_active(user: dict = Depends(get_current_user)) -> dict:
    g = await active_game(user["id"])
    return {"game": g}


@router.get("/history")
async def get_history(user: dict = Depends(get_current_user), limit: int = 20) -> dict:
    rows = await user_history(user["id"], limit=limit)
    return {"rows": rows}


@router.post("/start")
async def post_start(payload: StartIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await start_game(user["id"], payload.bet_ton, payload.mines_count)
    except MinesError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reveal")
async def post_reveal(payload: RevealIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await reveal_cell(user["id"], payload.game_id, payload.cell)
    except MinesError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cashout")
async def post_cashout(payload: CashoutIn, user: dict = Depends(get_current_user)) -> dict:
    try:
        return await cashout(user["id"], payload.game_id)
    except MinesError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/games/{game_id}/verify")
async def get_verify(
    game_id: str = Path(..., min_length=8, max_length=64),
    user: dict = Depends(get_current_user),
) -> dict:
    g = await get_game(game_id, user["id"])
    if not g:
        raise HTTPException(status_code=404, detail="game_not_found")
    if g.get("status") == "in_progress":
        raise HTTPException(status_code=400, detail="game_not_finished")
    # Find raw doc with server_seed
    from core.db import db
    raw = await db["mines_games"].find_one({"game_id": game_id}, {"_id": 0})
    v = verify_layout(
        raw["server_seed"], raw["server_seed_hash"], raw["client_seed"],
        raw["mines_count"], raw.get("mines", []),
    )
    return {
        "game_id": game_id,
        "server_seed": raw["server_seed"],
        "server_seed_hash": raw["server_seed_hash"],
        "client_seed": raw["client_seed"],
        "mines_count": raw["mines_count"],
        "claimed_mines": raw.get("mines", []),
        "derivation_note": "mines = Fisher–Yates over [0..24] driven by HMAC-SHA256(server_seed, client_seed:mines:N).",
        **v,
    }
