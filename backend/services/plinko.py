"""Phase 8 — Plinko service. Atomic single-ball drop."""
from __future__ import annotations

import logging
import secrets
from typing import Any

from core.db import db, users_col
from core.plinko_engine import (
    PlinkoError, derive_path, expected_rtp, final_bucket,
    get_multiplier, hash_server_seed, is_valid_combination, new_server_seed,
    ROWS_ALLOWED, RISKS_ALLOWED, MULTIPLIERS,
)
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.plinko")
bets_col = db["plinko_bets"]


MIN_BET_TON = 0.1
MAX_BET_TON = 100.0


def config() -> dict[str, Any]:
    return {
        "rows_allowed": list(ROWS_ALLOWED),
        "risks_allowed": list(RISKS_ALLOWED),
        "min_bet_ton": MIN_BET_TON,
        "max_bet_ton": MAX_BET_TON,
        "multiplier_tables": {
            f"{r}_{risk}": MULTIPLIERS[(r, risk)] for r in ROWS_ALLOWED for risk in RISKS_ALLOWED
        },
        "rtp_per_combo": {
            f"{r}_{risk}": round(expected_rtp(r, risk), 4)
            for r in ROWS_ALLOWED for risk in RISKS_ALLOWED
        },
    }


async def place_bet(
    user_id: str, bet_ton: float, rows: int, risk: str,
) -> dict[str, Any]:
    if not is_valid_combination(rows, risk):
        raise PlinkoError("invalid_combination")
    if bet_ton < MIN_BET_TON or bet_ton > MAX_BET_TON:
        raise PlinkoError("bet_out_of_range")

    # Atomic debit
    debited = await users_col.find_one_and_update(
        {"id": user_id, "balance_ton": {"$gte": bet_ton}},
        {"$inc": {"balance_ton": -bet_ton}, "$set": {"updated_at": iso(now())}},
        return_document=True, projection={"_id": 0, "balance_ton": 1},
    )
    if not debited:
        raise PlinkoError("insufficient_balance")

    # Generate seeds
    bet_id = secrets.token_hex(12)
    server_seed = new_server_seed()
    server_seed_hash = hash_server_seed(server_seed)
    client_seed = bet_id

    # Compute path + payout
    path = derive_path(server_seed, client_seed, rows)
    bucket = final_bucket(path)
    multiplier = get_multiplier(rows, risk, bucket)
    payout = round(bet_ton * multiplier, 6)

    # Credit payout (atomic)
    if payout > 0:
        upd = await users_col.find_one_and_update(
            {"id": user_id},
            {"$inc": {"balance_ton": payout}, "$set": {"updated_at": iso(now())}},
            return_document=True, projection={"_id": 0, "balance_ton": 1},
        )
        new_balance = float(upd.get("balance_ton") or 0)
    else:
        new_balance = float(debited.get("balance_ton") or 0)

    doc = {
        "bet_id": bet_id, "user_id": user_id,
        "bet_ton": bet_ton, "rows": rows, "risk": risk,
        "server_seed": server_seed, "server_seed_hash": server_seed_hash,
        "client_seed": client_seed,
        "path": path, "final_bucket": bucket,
        "multiplier": multiplier, "payout_ton": payout,
        "created_at": iso(now()),
    }
    await bets_col.insert_one(dict(doc))
    doc.pop("_id", None)

    # Fan-out hooks (XP / missions / achievements / activity)
    try:
        from services.actions import record_action
        await record_action(
            user_id, "plinko_drop", event_id=bet_id,
            amount_ton=bet_ton, multiplier=multiplier, payout_ton=payout,
            game="plinko",
        )
    except Exception as e:  # noqa: BLE001
        LOG.warning("plinko: actions hook failed: %s", e)

    return {
        "bet_id": bet_id,
        "server_seed_hash": server_seed_hash,
        "client_seed": client_seed,
        "rows": rows, "risk": risk,
        "path": path, "final_bucket": bucket,
        "multiplier": multiplier, "payout_ton": payout,
        "bet_ton": bet_ton,
        "new_balance_ton": new_balance,
    }


async def get_bet(bet_id: str) -> dict[str, Any] | None:
    doc = await bets_col.find_one({"bet_id": bet_id}, {"_id": 0})
    return doc


async def user_history(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    async for d in bets_col.find(
        {"user_id": user_id},
        {"_id": 0, "server_seed": 0},   # don't leak unrevealed seed
    ).sort("created_at", -1).limit(limit):
        rows.append(d)
    return rows
