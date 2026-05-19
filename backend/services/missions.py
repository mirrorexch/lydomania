"""Phase 8 — Daily Missions service.

3 missions per user per UTC date. Pool is rotated deterministically via
HMAC-SHA256 over (user_id, date), so a user sees stable missions all day.

Progress is tracked in `user_missions` (one doc per user+date). Hooks fire
on every game action via services.actions.record_action → update_progress.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db, users_col
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.missions")
user_missions_col = db["user_missions"]


# Mission pool. (id, kind, target, reward). Reward is one of:
#   {"type": "ton", "amount_ton": X}
#   {"type": "xp",  "amount": X}
#   {"type": "free_spin", "count": X}
POOL: list[dict[str, Any]] = [
    {"id": "m_spin_3_wheels",      "kind": "wheel_spin",     "target": 3,   "reward": {"type": "xp", "amount": 50},                "title": "Spin the wheel 3 times"},
    {"id": "m_open_5_cases",       "kind": "case_open",      "target": 5,   "reward": {"type": "xp", "amount": 75},                "title": "Open 5 cases"},
    {"id": "m_win_roulette",       "kind": "roulette_win",   "target": 1,   "reward": {"type": "free_spin", "count": 1},          "title": "Win 1 roulette bet"},
    {"id": "m_crash_cashout_3",    "kind": "crash_cashout",  "target": 3,   "reward": {"type": "ton", "amount_ton": 1.0},        "title": "Cash out Crash 3×"},
    {"id": "m_drop_10_plinko",     "kind": "plinko_drop",    "target": 10,  "reward": {"type": "xp", "amount": 80},                "title": "Drop Plinko 10 times"},
    {"id": "m_mines_cashout_2",    "kind": "mines_cashout",  "target": 2,   "reward": {"type": "ton", "amount_ton": 1.5},        "title": "Cash out Mines twice"},
    {"id": "m_battle_play_2",      "kind": "battle_win",     "target": 2,   "reward": {"type": "ton", "amount_ton": 2.0},        "title": "Win 2 battles"},
    {"id": "m_stake_5_ton",        "kind": "ton_wagered",    "target": 5,   "reward": {"type": "xp", "amount": 120},               "title": "Wager 5 TON total"},
    {"id": "m_open_pricey_case",   "kind": "case_open",      "target": 10,  "reward": {"type": "free_spin", "count": 2},         "title": "Open 10 cases"},
]


def _utc_date_today() -> str:
    return now().strftime("%Y-%m-%d")


def _pick_today(user_id: str, date_str: str, k: int = 3) -> list[str]:
    """Deterministic selection of k mission IDs from POOL for this user+date."""
    seed = hashlib.sha256(f"{user_id}:{date_str}".encode()).digest()
    # Fisher–Yates over indices using bytes
    idx = list(range(len(POOL)))
    pos = 0
    counter = 0
    for i in range(min(k, len(idx))):
        # Need int in [i, len(idx)-1]
        # Use 2 bytes from seed; reset every 16 bytes by re-hashing.
        if pos + 2 > len(seed):
            seed = hashlib.sha256(seed + counter.to_bytes(2, "big")).digest()
            pos = 0; counter += 1
        r = (seed[pos] << 8) | seed[pos + 1]; pos += 2
        j = i + (r % (len(idx) - i))
        idx[i], idx[j] = idx[j], idx[i]
    return [POOL[i]["id"] for i in idx[:k]]


async def get_or_create_daily(user_id: str) -> dict[str, Any]:
    date_str = _utc_date_today()
    doc = await user_missions_col.find_one(
        {"user_id": user_id, "date_utc": date_str}, {"_id": 0},
    )
    if doc:
        return _hydrate(doc)

    chosen_ids = _pick_today(user_id, date_str, k=3)
    fresh = {
        "user_id": user_id, "date_utc": date_str,
        "missions": [
            {"id": mid, "progress": 0, "claimed": False}
            for mid in chosen_ids
        ],
        "created_at": iso(now()),
        "updated_at": iso(now()),
    }
    try:
        await user_missions_col.insert_one(dict(fresh))
    except DuplicateKeyError:
        pass
    doc = await user_missions_col.find_one(
        {"user_id": user_id, "date_utc": date_str}, {"_id": 0},
    )
    return _hydrate(doc or fresh)


def _hydrate(doc: dict) -> dict[str, Any]:
    """Attach mission metadata + completion flag for the client."""
    out_missions: list[dict] = []
    for m in (doc.get("missions") or []):
        meta = next((p for p in POOL if p["id"] == m["id"]), None) or {}
        progress = int(m.get("progress") or 0)
        target = int(meta.get("target") or 1)
        out_missions.append({
            "id": m["id"],
            "title": meta.get("title", m["id"]),
            "kind": meta.get("kind", "unknown"),
            "target": target,
            "progress": min(progress, target),
            "complete": progress >= target,
            "claimed": bool(m.get("claimed")),
            "reward": meta.get("reward", {}),
        })
    return {
        "date_utc": doc.get("date_utc"),
        "missions": out_missions,
    }


async def update_progress(user_id: str, kind: str, amount_ton: float = 0.0) -> None:
    """Increment progress for any active mission matching `kind`."""
    date_str = _utc_date_today()
    daily = await user_missions_col.find_one(
        {"user_id": user_id, "date_utc": date_str}, {"_id": 0},
    )
    if not daily:
        # Lazy-init then re-fetch
        await get_or_create_daily(user_id)
        daily = await user_missions_col.find_one(
            {"user_id": user_id, "date_utc": date_str}, {"_id": 0},
        )
    if not daily:
        return

    updates: list[dict] = []
    for i, m in enumerate(daily.get("missions") or []):
        meta = next((p for p in POOL if p["id"] == m["id"]), None)
        if not meta:
            continue
        if meta["kind"] == kind:
            inc = 1
            updates.append({"i": i, "inc": inc})
        elif meta["kind"] == "ton_wagered" and amount_ton > 0:
            # Wager-tracking mission: increment by floor(amount_ton)
            inc = int(amount_ton)
            if inc > 0:
                updates.append({"i": i, "inc": inc})

    if not updates:
        return

    set_ops = {f"missions.{u['i']}.progress": daily["missions"][u["i"]].get("progress", 0)
               for u in updates}
    inc_ops = {f"missions.{u['i']}.progress": u["inc"] for u in updates}
    await user_missions_col.update_one(
        {"user_id": user_id, "date_utc": date_str},
        {"$inc": inc_ops, "$set": {"updated_at": iso(now())}},
    )


class MissionError(Exception):
    """Surface as 400."""


async def claim(user_id: str, mission_id: str) -> dict[str, Any]:
    date_str = _utc_date_today()
    daily = await user_missions_col.find_one(
        {"user_id": user_id, "date_utc": date_str}, {"_id": 0},
    )
    if not daily:
        raise MissionError("no_daily_missions")
    target_idx = None
    for i, m in enumerate(daily.get("missions") or []):
        if m["id"] == mission_id:
            target_idx = i
            break
    if target_idx is None:
        raise MissionError("mission_not_assigned")
    meta = next((p for p in POOL if p["id"] == mission_id), None)
    if not meta:
        raise MissionError("unknown_mission")
    mission = daily["missions"][target_idx]
    if mission.get("claimed"):
        raise MissionError("already_claimed")
    if int(mission.get("progress") or 0) < int(meta["target"]):
        raise MissionError("incomplete")

    # Atomic flip
    flipped = await user_missions_col.find_one_and_update(
        {"user_id": user_id, "date_utc": date_str,
         f"missions.{target_idx}.claimed": False},
        {"$set": {f"missions.{target_idx}.claimed": True,
                  "updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not flipped:
        raise MissionError("already_claimed_race")

    # Grant reward
    reward = meta.get("reward", {})
    rtype = reward.get("type")
    if rtype == "ton":
        await users_col.update_one(
            {"id": user_id},
            {"$inc": {"balance_ton": float(reward.get("amount_ton") or 0)}},
        )
    elif rtype == "free_spin":
        await users_col.update_one(
            {"id": user_id},
            {"$inc": {"free_spin_tokens": int(reward.get("count") or 1)}},
        )
    elif rtype == "xp":
        try:
            from services.season import award_xp
            await award_xp(
                user_id, int(reward.get("amount") or 0),
                "admin_grant", f"mission_claim:{date_str}:{mission_id}",
            )
        except Exception as e:  # noqa: BLE001
            LOG.warning("mission xp grant failed: %s", e)

    return {"mission_id": mission_id, "reward": reward,
            "claimed_at": iso(now())}


async def ensure_indexes() -> None:
    await user_missions_col.create_index(
        [("user_id", ASCENDING), ("date_utc", ASCENDING)], unique=True,
    )
