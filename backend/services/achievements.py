"""Phase 8 — Achievements service.

Stateless catalog (core.achievements_catalog) + stateful per-user progress
tracked via `user_achievement_counters` (counter values per source kind)
and `user_achievements` (unlocked + claimed states).
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, ReturnDocument

from core.achievements_catalog import CATALOG, by_id, evaluate_progress
from core.db import db, users_col
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.achievements")

counters_col = db["user_achievement_counters"]
unlocks_col  = db["user_achievements"]


async def ensure_indexes() -> None:
    await counters_col.create_index("user_id", unique=True)
    await unlocks_col.create_index(
        [("user_id", ASCENDING), ("achievement_id", ASCENDING)], unique=True,
    )


class AchievementError(Exception):
    """Surface as 400."""


# ── Counter sources we track. Map game action → counter keys to increment ──
def _counter_increments(
    kind: str, amount_ton: float, multiplier: float | None, payout_ton: float,
) -> dict[str, int]:
    incs: dict[str, int] = {}
    # Single-event sources
    if kind in ("wheel_spin", "case_open", "roulette_win", "crash_cashout",
                "plinko_drop", "mines_cashout", "battle_win", "premium_unlock",
                "season_tier_30"):
        incs[kind] = 1
    # Threshold: total TON won
    if payout_ton > 0:
        incs["ton_won"] = int(payout_ton)
    # Big-multiplier flags
    if multiplier is not None:
        if multiplier >= 50:
            incs["big_multiplier_50x"] = 1
            incs["big_multiplier_5x"]  = 1
        elif multiplier >= 5:
            incs["big_multiplier_5x"]  = 1
    return incs


async def evaluate_after(
    user_id: str, kind: str,
    *, amount_ton: float = 0.0, multiplier: float | None = None,
    payout_ton: float = 0.0,
) -> list[str]:
    """Increment counters then check for newly-unlocked achievements.

    Returns the list of `achievement_id`s unlocked by this call (best-effort).
    """
    incs = _counter_increments(kind, amount_ton, multiplier, payout_ton)
    if not incs:
        return []

    # Atomic upsert + $inc on the counters doc
    inc_doc = {f"counters.{k}": v for k, v in incs.items()}
    counters = await counters_col.find_one_and_update(
        {"user_id": user_id},
        {"$inc": inc_doc, "$set": {"updated_at": iso(now())},
         "$setOnInsert": {"user_id": user_id, "created_at": iso(now())}},
        upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    cur_counters = (counters or {}).get("counters", {})

    # Find achievements whose criteria are now satisfied & not yet unlocked
    newly: list[str] = []
    for a in CATALOG:
        unlocked, _, _ = evaluate_progress(a["criteria"], cur_counters)
        if not unlocked:
            continue
        # Try to insert an unlock row — duplicate key = already there
        try:
            await unlocks_col.insert_one({
                "user_id": user_id,
                "achievement_id": a["achievement_id"],
                "unlocked_at": iso(now()),
                "claimed": False,
            })
            newly.append(a["achievement_id"])
        except Exception:
            # Duplicate key (already unlocked) → no-op
            pass
    return newly


async def list_for_user(user_id: str) -> list[dict[str, Any]]:
    counters = await counters_col.find_one({"user_id": user_id}, {"_id": 0}) or {}
    cur = counters.get("counters", {})
    unlocks = {}
    async for u in unlocks_col.find({"user_id": user_id}, {"_id": 0}):
        unlocks[u["achievement_id"]] = u
    out: list[dict[str, Any]] = []
    for a in CATALOG:
        unlocked, cur_val, tgt = evaluate_progress(a["criteria"], cur)
        u = unlocks.get(a["achievement_id"])
        out.append({
            **a,
            "progress": cur_val,
            "target": tgt,
            "unlocked": bool(u),
            "unlocked_at": u.get("unlocked_at") if u else None,
            "claimed": bool(u and u.get("claimed")),
        })
    return out


async def list_all() -> list[dict[str, Any]]:
    return list(CATALOG)


async def claim(user_id: str, achievement_id: str) -> dict[str, Any]:
    a = by_id(achievement_id)
    if not a:
        raise AchievementError("unknown_achievement")

    u = await unlocks_col.find_one(
        {"user_id": user_id, "achievement_id": achievement_id}, {"_id": 0},
    )
    if not u:
        raise AchievementError("not_unlocked")
    if u.get("claimed"):
        raise AchievementError("already_claimed")

    flipped = await unlocks_col.find_one_and_update(
        {"user_id": user_id, "achievement_id": achievement_id, "claimed": False},
        {"$set": {"claimed": True, "claimed_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not flipped:
        raise AchievementError("already_claimed_race")

    # Grant reward
    r = a["reward"]
    if r["type"] == "ton":
        await users_col.update_one(
            {"id": user_id},
            {"$inc": {"balance_ton": float(r.get("amount_ton") or 0)}},
        )
    elif r["type"] == "free_spin":
        await users_col.update_one(
            {"id": user_id},
            {"$inc": {"free_spin_tokens": int(r.get("count") or 1)}},
        )
    elif r["type"] == "xp":
        try:
            from services.season import award_xp
            await award_xp(
                user_id, int(r.get("amount") or 0),
                "admin_grant", f"achievement_claim:{achievement_id}",
            )
        except Exception as e:  # noqa: BLE001
            LOG.warning("achievement xp grant failed: %s", e)
    return {"achievement_id": achievement_id, "reward": r,
            "claimed_at": iso(now())}
