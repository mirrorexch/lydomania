"""Phase 8 — Mines service. Stateful game lifecycle."""
from __future__ import annotations

import logging
import secrets
from typing import Any

from pymongo import ReturnDocument

from core.db import db, users_col
from core.mines_engine import (
    GRID_SIZE, MINES_MAX, MINES_MIN, MinesError, derive_mines, hash_server_seed,
    multiplier_for, new_server_seed,
)
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.mines")
games_col = db["mines_games"]

MIN_BET_TON = 0.1
MAX_BET_TON = 100.0


async def start_game(user_id: str, bet_ton: float, mines_count: int) -> dict[str, Any]:
    if bet_ton < MIN_BET_TON or bet_ton > MAX_BET_TON:
        raise MinesError("bet_out_of_range")
    if mines_count < MINES_MIN or mines_count > MINES_MAX:
        raise MinesError("invalid_mines_count")

    # Single in-flight rule: cancel any old in_progress game silently
    await games_col.update_many(
        {"user_id": user_id, "status": "in_progress"},
        {"$set": {"status": "abandoned", "abandoned_at": iso(now())}},
    )

    # Debit
    debited = await users_col.find_one_and_update(
        {"id": user_id, "balance_ton": {"$gte": bet_ton}},
        {"$inc": {"balance_ton": -bet_ton}, "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0, "balance_ton": 1},
    )
    if not debited:
        raise MinesError("insufficient_balance")

    game_id = secrets.token_hex(12)
    server_seed = new_server_seed()
    server_seed_hash = hash_server_seed(server_seed)
    client_seed = game_id

    doc = {
        "game_id": game_id, "user_id": user_id,
        "bet_ton": bet_ton, "mines_count": mines_count,
        "grid_size": GRID_SIZE,
        "server_seed": server_seed, "server_seed_hash": server_seed_hash,
        "client_seed": client_seed,
        "revealed": [], "status": "in_progress",
        "current_multiplier": 1.0, "payout_ton": 0.0,
        "created_at": iso(now()),
    }
    await games_col.insert_one(dict(doc))

    return {
        "game_id": game_id, "server_seed_hash": server_seed_hash,
        "client_seed": client_seed, "grid_size": GRID_SIZE,
        "mines_count": mines_count, "bet_ton": bet_ton,
        "current_multiplier": 1.0, "revealed": [],
        "new_balance_ton": float(debited.get("balance_ton") or 0),
    }


async def reveal_cell(user_id: str, game_id: str, cell: int) -> dict[str, Any]:
    if cell < 0 or cell >= GRID_SIZE:
        raise MinesError("invalid_cell")
    g = await games_col.find_one({"game_id": game_id, "user_id": user_id}, {"_id": 0})
    if not g:
        raise MinesError("game_not_found")
    if g["status"] != "in_progress":
        raise MinesError("game_not_active")
    if cell in (g.get("revealed") or []):
        raise MinesError("already_revealed")

    mines = derive_mines(g["server_seed"], g["client_seed"], g["mines_count"])

    if cell in mines:
        # BUST — game over, reveal everything
        await games_col.update_one(
            {"game_id": game_id},
            {"$set": {
                "status": "bust", "hit_mine_at": cell,
                "ended_at": iso(now()),
                "mines": sorted(list(mines)),
            }},
        )
        try:
            from services.actions import record_action
            await record_action(
                user_id, "mines_bust", event_id=game_id,
                amount_ton=float(g["bet_ton"]), payout_ton=0.0, game="mines",
            )
        except Exception as e:  # noqa: BLE001
            LOG.warning("mines: actions hook failed on bust: %s", e)
        return {
            "hit_mine": True, "cell": cell,
            "server_seed": g["server_seed"],
            "server_seed_hash": g["server_seed_hash"],
            "client_seed": g["client_seed"],
            "mines": sorted(list(mines)),
            "bet_ton": float(g["bet_ton"]), "payout_ton": 0.0,
        }

    # Safe reveal — increment revealed list & update multiplier
    revealed_after = list(g.get("revealed") or []) + [cell]
    mult = multiplier_for(g["mines_count"], len(revealed_after))
    await games_col.update_one(
        {"game_id": game_id},
        {"$set": {"revealed": revealed_after, "current_multiplier": mult,
                  "updated_at": iso(now())}},
    )
    return {
        "hit_mine": False, "cell": cell,
        "revealed_count": len(revealed_after),
        "current_multiplier": mult,
        "next_multiplier": multiplier_for(g["mines_count"], len(revealed_after) + 1)
            if len(revealed_after) + 1 <= (GRID_SIZE - g["mines_count"]) else None,
    }


async def cashout(user_id: str, game_id: str) -> dict[str, Any]:
    g = await games_col.find_one({"game_id": game_id, "user_id": user_id}, {"_id": 0})
    if not g:
        raise MinesError("game_not_found")
    if g["status"] != "in_progress":
        raise MinesError("game_not_active")
    revealed = g.get("revealed") or []
    if len(revealed) == 0:
        raise MinesError("nothing_to_cashout")

    mult = multiplier_for(g["mines_count"], len(revealed))
    payout = round(float(g["bet_ton"]) * mult, 6)

    flipped = await games_col.find_one_and_update(
        {"game_id": game_id, "status": "in_progress"},
        {"$set": {
            "status": "cashed_out", "current_multiplier": mult, "payout_ton": payout,
            "ended_at": iso(now()),
            "mines": sorted(list(derive_mines(g["server_seed"], g["client_seed"], g["mines_count"]))),
        }},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not flipped:
        raise MinesError("race_lost")

    # Credit balance
    upd = await users_col.find_one_and_update(
        {"id": user_id},
        {"$inc": {"balance_ton": payout}, "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0, "balance_ton": 1},
    )
    try:
        from services.actions import record_action
        await record_action(
            user_id, "mines_cashout", event_id=game_id,
            amount_ton=float(g["bet_ton"]), multiplier=mult, payout_ton=payout,
            game="mines",
        )
    except Exception as e:  # noqa: BLE001
        LOG.warning("mines: actions hook failed on cashout: %s", e)

    return {
        "game_id": game_id, "multiplier": mult, "payout_ton": payout,
        "server_seed": flipped["server_seed"],
        "server_seed_hash": flipped["server_seed_hash"],
        "client_seed": flipped["client_seed"],
        "mines": flipped["mines"],
        "new_balance_ton": float(upd.get("balance_ton") or 0),
    }


async def get_game(game_id: str, user_id: str) -> dict[str, Any] | None:
    g = await games_col.find_one({"game_id": game_id, "user_id": user_id}, {"_id": 0})
    if g and g.get("status") == "in_progress":
        g.pop("server_seed", None)  # don't leak pre-reveal
    return g


async def active_game(user_id: str) -> dict[str, Any] | None:
    g = await games_col.find_one(
        {"user_id": user_id, "status": "in_progress"},
        {"_id": 0, "server_seed": 0},
    )
    return g


async def user_history(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    async for d in games_col.find(
        {"user_id": user_id, "status": {"$in": ["cashed_out", "bust", "abandoned"]}},
        # Don't leak server_seed on rows older than reveal — but they were finished,
        # so seed is safe to return for verification anyway.
        {"_id": 0},
    ).sort("created_at", -1).limit(limit):
        rows.append(d)
    return rows
