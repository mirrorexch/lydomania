"""Phase 9 — VIP / Loyalty tiers.

Tiers based on lifetime_wagered_ton (incremented per game action).
Each tier grants perks: rakeback bps, daily free spin tokens,
mission XP multiplier, marketplace fee discount bps.

Stored snapshot on user.vip_tier for fast reads; recomputed lazily on /vip/me.
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, ReturnDocument

from core.db import db, users_col
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.vip")
rakeback_log_col = db["vip_rakeback_log"]

# Tier table: (tier_id, name, min_wagered_ton, rakeback_bps, daily_free_spins,
#              xp_multiplier_bps (10000=1.0×), marketplace_fee_discount_bps)
TIERS: list[dict[str, Any]] = [
    {"tier_id": 0, "name": "Bronze",   "min_wagered_ton": 0,     "rakeback_bps": 50,  "daily_free_spins": 0, "xp_multiplier_bps": 10_000, "marketplace_fee_discount_bps": 0,   "icon": "shield"},
    {"tier_id": 1, "name": "Silver",   "min_wagered_ton": 100,   "rakeback_bps": 100, "daily_free_spins": 1, "xp_multiplier_bps": 10_500, "marketplace_fee_discount_bps": 50,  "icon": "shield-half"},
    {"tier_id": 2, "name": "Gold",     "min_wagered_ton": 500,   "rakeback_bps": 150, "daily_free_spins": 2, "xp_multiplier_bps": 11_000, "marketplace_fee_discount_bps": 100, "icon": "shield-check"},
    {"tier_id": 3, "name": "Platinum", "min_wagered_ton": 2_500, "rakeback_bps": 200, "daily_free_spins": 3, "xp_multiplier_bps": 12_000, "marketplace_fee_discount_bps": 200, "icon": "gem"},
    {"tier_id": 4, "name": "Diamond",  "min_wagered_ton": 10_000,"rakeback_bps": 300, "daily_free_spins": 5, "xp_multiplier_bps": 15_000, "marketplace_fee_discount_bps": 300, "icon": "crown"},
]


def tier_for_wagered(wagered_ton: float) -> dict[str, Any]:
    """Return the highest tier whose min_wagered_ton ≤ wagered_ton."""
    cur = TIERS[0]
    for t in TIERS:
        if wagered_ton >= float(t["min_wagered_ton"]):
            cur = t
    return cur


def next_tier_for(current_tier_id: int) -> dict[str, Any] | None:
    for t in TIERS:
        if int(t["tier_id"]) == current_tier_id + 1:
            return t
    return None


async def ensure_indexes() -> None:
    await rakeback_log_col.create_index(
        [("user_id", ASCENDING), ("date_utc", ASCENDING)], unique=True,
    )


async def increment_wagered(user_id: str, amount_ton: float) -> None:
    """Hook called by services.actions on every wager. Idempotency relies on
    record_action's own idempotency (event_id deduped upstream)."""
    if amount_ton <= 0:
        return
    await users_col.update_one(
        {"id": user_id},
        {"$inc": {"lifetime_wagered_ton": float(amount_ton)},
         "$set": {"updated_at": iso(now())}},
    )


async def get_vip_state(user_id: str) -> dict[str, Any]:
    u = await users_col.find_one(
        {"id": user_id},
        {"_id": 0, "lifetime_wagered_ton": 1, "vip_tier": 1, "balance_ton": 1},
    ) or {}
    wagered = float(u.get("lifetime_wagered_ton") or 0)
    cur = tier_for_wagered(wagered)
    nxt = next_tier_for(int(cur["tier_id"]))
    # Snapshot current tier on the user doc for fast UI reads
    if int(u.get("vip_tier") or -1) != int(cur["tier_id"]):
        await users_col.update_one(
            {"id": user_id},
            {"$set": {"vip_tier": int(cur["tier_id"]),
                      "updated_at": iso(now())}},
        )
    return {
        "tier": cur,
        "next_tier": nxt,
        "lifetime_wagered_ton": wagered,
        "to_next_tier_ton": max(0.0, (float(nxt["min_wagered_ton"]) - wagered)) if nxt else 0.0,
        "balance_ton": float(u.get("balance_ton") or 0),
    }


async def marketplace_fee_discount_bps(user_id: str) -> int:
    state = await get_vip_state(user_id)
    return int(state["tier"].get("marketplace_fee_discount_bps") or 0)


async def xp_multiplier_bps(user_id: str) -> int:
    state = await get_vip_state(user_id)
    return int(state["tier"].get("xp_multiplier_bps") or 10_000)


class VipError(Exception):
    """Surface as 400."""


def _utc_date_today() -> str:
    return now().strftime("%Y-%m-%d")


async def claim_rakeback(user_id: str) -> dict[str, Any]:
    """One-shot per UTC date. Awards rakeback_bps × yesterday's wagered."""
    today = _utc_date_today()
    state = await get_vip_state(user_id)
    bps = int(state["tier"].get("rakeback_bps") or 0)
    if bps <= 0:
        raise VipError("no_rakeback_perk")
    # We don't track per-day wager; instead award rakeback_bps × lifetime_wagered_ton × 0.01%
    # cap (so the daily payout is small). Concretely: bps × (lifetime / 10,000_000) per day.
    # This keeps rakeback as a low-frequency drip aligned with their tier.
    daily_payout = round(
        max(0.0, float(state["lifetime_wagered_ton"]) * bps / 10_000 / 100),
        6,
    )
    if daily_payout <= 0:
        raise VipError("nothing_to_claim")

    # Atomic insert (idempotency key = user_id + date)
    try:
        await rakeback_log_col.insert_one({
            "user_id": user_id, "date_utc": today,
            "tier_id": state["tier"]["tier_id"],
            "payout_ton": daily_payout,
            "created_at": iso(now()),
        })
    except Exception:
        raise VipError("already_claimed")

    await users_col.update_one(
        {"id": user_id},
        {"$inc": {"balance_ton": daily_payout},
         "$set": {"updated_at": iso(now())}},
    )
    fresh = await users_col.find_one(
        {"id": user_id}, {"_id": 0, "balance_ton": 1},
    )
    return {
        "claimed_ton": daily_payout, "date_utc": today,
        "new_balance_ton": float(fresh.get("balance_ton") or 0),
    }


async def already_claimed_today(user_id: str) -> bool:
    today = _utc_date_today()
    n = await rakeback_log_col.count_documents({"user_id": user_id, "date_utc": today})
    return n > 0
