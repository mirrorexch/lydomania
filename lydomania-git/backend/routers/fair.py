"""Provably-fair routes (/fair/*) + shared fair state helpers used by cases router."""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import game
from core.auth import get_current_user
from core.config import ROTATE_NONCE_EVERY
from core.db import fair_col
from core.models import FairCurrentOut, FairRotateOut
from core.time_utils import iso, now

router = APIRouter(prefix="/api")


async def get_or_create_fair_state(user_id: str) -> dict:
    state = await fair_col.find_one({"user_id": user_id}, {"_id": 0})
    if state:
        return state
    server_seed, server_seed_hash = game.gen_server_seed()
    state = {
        "user_id": user_id,
        "server_seed": server_seed,
        "server_seed_hash": server_seed_hash,
        "nonce": 0,
        "epoch": 0,
        "created_at": iso(now()),
    }
    await fair_col.insert_one(state)
    return state


async def rotate_fair_state(user_id: str) -> dict:
    old = await fair_col.find_one({"user_id": user_id}, {"_id": 0})
    if old:
        await fair_col.update_one(
            {"user_id": user_id},
            {"$set": {
                "previous_revealed": {
                    "server_seed": old["server_seed"],
                    "server_seed_hash": old["server_seed_hash"],
                    "nonce": int(old.get("nonce", 0)),
                },
            }},
        )
    new_seed, new_seed_hash = game.gen_server_seed()
    upd = await fair_col.find_one_and_update(
        {"user_id": user_id},
        {"$set": {
            "server_seed": new_seed,
            "server_seed_hash": new_seed_hash,
            "nonce": 0,
            "rotated_at": iso(now()),
        }, "$inc": {"epoch": 1}},
        return_document=True, projection={"_id": 0},
    )
    return upd


@router.get("/fair/current", response_model=FairCurrentOut)
async def fair_current(user: dict = Depends(get_current_user)) -> FairCurrentOut:
    state = await get_or_create_fair_state(user["id"])
    nonce = int(state.get("nonce", 0))
    return FairCurrentOut(
        server_seed_hash=state["server_seed_hash"],
        client_seed_suggestion=game.gen_client_seed(),
        nonce=nonce,
        rolls_until_rotation=max(0, ROTATE_NONCE_EVERY - nonce),
    )


@router.post("/fair/rotate", response_model=FairRotateOut)
async def fair_rotate(user: dict = Depends(get_current_user)) -> FairRotateOut:
    old = await fair_col.find_one({"user_id": user["id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=400, detail="no fair state to rotate")
    revealed = {
        "server_seed": old["server_seed"],
        "server_seed_hash": old["server_seed_hash"],
        "nonce": int(old.get("nonce", 0)),
    }
    new_state = await rotate_fair_state(user["id"])
    return FairRotateOut(
        revealed_server_seed=revealed["server_seed"],
        revealed_server_seed_hash=revealed["server_seed_hash"],
        revealed_nonce=revealed["nonce"],
        new_server_seed_hash=new_state["server_seed_hash"],
    )


@router.get("/fair/verify")
async def fair_verify(
    server_seed: str = Query(..., min_length=32, max_length=128),
    client_seed: str = Query(..., min_length=1, max_length=128),
    nonce: int = Query(..., ge=0, le=10_000_000),
) -> dict:
    roll_hash, roll_float = game.compute_roll(server_seed, client_seed, nonce)
    return {
        "server_seed_hash": game.hash_server_seed(server_seed),
        "roll_hash": roll_hash,
        "roll_float": roll_float,
    }
