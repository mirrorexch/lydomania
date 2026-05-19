"""Phase 7c — Battle Pass / Seasons service layer.

Owns:
  • Active season lifecycle (get-or-create, rollover, force-end)
  • Per-user progress fetch / lazy-init
  • Idempotent XP award (audited via `season_xp_events` collection)
  • Atomic tier claim (no double-claim under concurrent calls)
  • Premium unlock (atomic 50 TON debit + retroactive flag flip)
  • Daily-login XP helper (one award per UTC date per user)
  • Leaderboard

Concurrency:
  • `award_xp` uses an insert into `season_xp_events` with a unique compound
    index on (event_id, source) as the gate. Duplicate inserts raise
    DuplicateKeyError → we treat that as a no-op and return.
  • `claim_tier` uses `find_one_and_update` with the array-membership clause
    `claimed_*_tiers: {$ne: tier}` so concurrent claims are impossible.
  • `unlock_premium` uses atomic CAS `premium_unlocked: {$ne: True}` +
    `balance_ton: {$gte: 50}` so both the debit and the flip happen exactly once.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db, inventory_col, items_col, users_col
from core.season_engine import (
    DAILY_LOGIN_XP, PREMIUM_UNLOCK_TON, REFERRAL_FIRST_DEPOSIT_XP,
    SEASON_DURATION_DAYS, TOTAL_TIERS, cumulative_xp_for_tier,
    default_tier_rewards, tier_from_xp, validate_track, validate_xp_source,
    xp_for_tier, xp_progress_into_current_tier,
)
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.season")

seasons_col   = db["seasons"]
progress_col  = db["user_season_progress"]
xp_events_col = db["season_xp_events"]


class SeasonError(Exception):
    """Surface as 400 in the router."""


# ─── Index bootstrap (idempotent) ───────────────────────────────────────────
async def ensure_indexes() -> None:
    await seasons_col.create_index("season_id", unique=True)
    await seasons_col.create_index([("status", ASCENDING), ("ends_at", ASCENDING)])
    await progress_col.create_index(
        [("user_id", ASCENDING), ("season_id", ASCENDING)], unique=True,
    )
    await progress_col.create_index([("season_id", ASCENDING), ("xp", -1)])
    await xp_events_col.create_index(
        [("event_id", ASCENDING), ("source", ASCENDING)], unique=True,
    )
    await xp_events_col.create_index([("user_id", ASCENDING), ("created_at", -1)])


# ─── Season lifecycle ──────────────────────────────────────────────────────
def _new_season_id() -> str:
    return f"s_{secrets.token_hex(6)}"


def _season_name_for(start: datetime, index: int) -> str:
    return f"Season {index} · {start.strftime('%b %Y')}"


async def _next_season_index() -> int:
    """Auto-increment season index by counting existing seasons."""
    count = await seasons_col.count_documents({})
    return count + 1


async def get_or_create_active_season() -> dict[str, Any]:
    """Fetch the live season. Lazy-create the first one if none exist."""
    doc = await seasons_col.find_one({"status": "active"}, {"_id": 0})
    if doc:
        # Backfill seed_hash for seasons created before the audit hash was added.
        if not doc.get("seed_hash"):
            seed_material = json.dumps({
                "season_id": doc["season_id"],
                "started_at": doc["started_at"],
                "tier_rewards": doc.get("tier_rewards", []),
            }, sort_keys=True, separators=(",", ":")).encode("utf-8")
            doc["seed_hash"] = hashlib.sha256(seed_material).hexdigest()
            await seasons_col.update_one(
                {"season_id": doc["season_id"]},
                {"$set": {"seed_hash": doc["seed_hash"]}},
            )
        return doc
    # Lazy bootstrap: only happens on a brand-new deploy
    return await _create_season(starts_at=now(), index=await _next_season_index())


async def _create_season(starts_at: datetime, index: int) -> dict[str, Any]:
    season_id = _new_season_id()
    ends_at = starts_at + timedelta(days=SEASON_DURATION_DAYS)
    tier_rewards = default_tier_rewards()
    # Deterministic audit hash of the reward table — anyone can recompute this
    # from {season_id, started_at, tier_rewards} to prove the rewards weren't
    # silently re-shuffled after launch.
    seed_material = json.dumps(
        {
            "season_id": season_id,
            "started_at": iso(starts_at),
            "tier_rewards": tier_rewards,
        },
        sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    seed_hash = hashlib.sha256(seed_material).hexdigest()
    doc = {
        "season_id": season_id,
        "name": _season_name_for(starts_at, index),
        "index": index,
        "started_at": iso(starts_at),
        "ends_at": iso(ends_at),
        "status": "active",
        "tier_rewards": tier_rewards,
        "total_tiers": TOTAL_TIERS,
        "premium_unlock_ton": PREMIUM_UNLOCK_TON,
        "seed_hash": seed_hash,
        "created_at": iso(now()),
    }
    await seasons_col.insert_one(doc)
    doc.pop("_id", None)
    LOG.info(
        "[season] created %s (%s) starts=%s ends=%s seed_hash=%s",
        season_id, doc["name"], doc["started_at"], doc["ends_at"], seed_hash[:12] + "…",
    )
    return doc


async def rollover_if_needed() -> dict[str, Any] | None:
    """APScheduler cron: if active season's ends_at < now, freeze it and create next.

    Race-safe via atomic status flip — only one rollover happens even if the
    scheduler fires concurrently in multiple workers.
    """
    threshold = iso(now())
    frozen = await seasons_col.find_one_and_update(
        {"status": "active", "ends_at": {"$lt": threshold}},
        {"$set": {"status": "frozen", "frozen_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
    )
    if not frozen:
        return None
    LOG.info("[season] rolled over: %s (was %s)", frozen["season_id"], frozen.get("name"))
    next_idx = (int(frozen.get("index") or 1)) + 1
    new = await _create_season(starts_at=now(), index=next_idx)
    return new


# ─── Per-user progress ────────────────────────────────────────────────────
def _progress_doc(user_id: str, season_id: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "season_id": season_id,
        "xp": 0,
        "premium_unlocked": False,
        "claimed_free_tiers": [],
        "claimed_premium_tiers": [],
        "created_at": iso(now()),
        "updated_at": iso(now()),
    }


async def get_user_progress(user_id: str, season_id: str) -> dict[str, Any]:
    """Fetch user's progress, lazy-creating on first access. Strips `_id`."""
    doc = await progress_col.find_one(
        {"user_id": user_id, "season_id": season_id}, {"_id": 0},
    )
    if doc:
        return doc
    fresh = _progress_doc(user_id, season_id)
    try:
        await progress_col.insert_one(dict(fresh))    # copy so insert doesn't pollute return
    except DuplicateKeyError:
        # Another concurrent caller beat us — fetch what they wrote
        doc = await progress_col.find_one(
            {"user_id": user_id, "season_id": season_id}, {"_id": 0},
        )
        if doc:
            return doc
    return fresh


def hydrate_progress(prog: dict[str, Any]) -> dict[str, Any]:
    """Compute derived fields for the API response."""
    xp = int(prog.get("xp") or 0)
    into, needed, next_tier = xp_progress_into_current_tier(xp)
    current = tier_from_xp(xp)
    return {
        **prog,
        "xp": xp,
        "current_tier": current,
        "xp_into_current_tier": into,
        "xp_for_next_tier": needed,
        "next_tier": next_tier,
        "total_tiers": TOTAL_TIERS,
    }


# ─── XP award (idempotent) ───────────────────────────────────────────────
async def award_xp(
    user_id: str, amount: int, source: str, event_id: str,
    season_id: str | None = None,
) -> dict[str, Any]:
    """Idempotently credit XP to a user's current-season progress.

    `event_id` is the unique key of the action that earned the XP
    (e.g. roll_id, bet_id, spin_id, "login:<YYYY-MM-DD>"). Combined with
    `source` it forms the audit-collection unique key.

    Returns: {"awarded": int, "new_xp": int, "current_tier": int,
              "already_awarded": bool, "event_id": str}
    """
    if amount <= 0:
        return {"awarded": 0, "already_awarded": False, "skipped": True}
    if not validate_xp_source(source):
        raise SeasonError(f"invalid_source:{source}")

    # Always award against the currently active season (so XP earned during
    # the rollover lands in the new season, never the frozen one).
    if season_id is None:
        season = await get_or_create_active_season()
        season_id = season["season_id"]
    elif season_id == "current":
        season = await get_or_create_active_season()
        season_id = season["season_id"]

    # Idempotency gate — insert audit row first. DuplicateKeyError → no-op.
    audit_doc = {
        "event_id": event_id,
        "source": source,
        "user_id": user_id,
        "season_id": season_id,
        "amount": int(amount),
        "created_at": iso(now()),
    }
    try:
        await xp_events_col.insert_one(audit_doc)
    except DuplicateKeyError:
        # Already credited — return current state without mutating XP.
        prog = await get_user_progress(user_id, season_id)
        return {
            "awarded": 0,
            "new_xp": int(prog.get("xp") or 0),
            "current_tier": tier_from_xp(int(prog.get("xp") or 0)),
            "already_awarded": True,
            "event_id": event_id,
        }

    # Ensure progress doc exists (race-safe), then atomic $inc.
    await get_user_progress(user_id, season_id)
    updated = await progress_col.find_one_and_update(
        {"user_id": user_id, "season_id": season_id},
        {"$inc": {"xp": int(amount)},
         "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not updated:
        # Shouldn't happen — but if get_user_progress couldn't insert (e.g.
        # DB transient error), our audit row would be orphaned. Roll it back.
        await xp_events_col.delete_one(
            {"event_id": event_id, "source": source},
        )
        raise SeasonError("progress_doc_missing")

    new_xp = int(updated.get("xp") or 0)

    # Phase 8 — fan out to missions + achievements (best-effort, idempotent already
    # because we only reach this point on first-time award per event_id).
    try:
        from services.missions import update_progress as _miss
        await _miss(user_id, source, amount_ton=0.0)
    except Exception as _e:  # noqa: BLE001
        LOG.warning("season: missions fan-out failed (%s): %s", source, _e)
    try:
        from services.achievements import evaluate_after as _ach
        await _ach(user_id, source)
    except Exception as _e:  # noqa: BLE001
        LOG.warning("season: achievements fan-out failed (%s): %s", source, _e)

    return {
        "awarded": int(amount),
        "new_xp": new_xp,
        "current_tier": tier_from_xp(new_xp),
        "already_awarded": False,
        "event_id": event_id,
    }


# ─── Daily-login XP helper ────────────────────────────────────────────────
def _utc_date_today() -> str:
    return now().strftime("%Y-%m-%d")


async def maybe_award_daily_login(user_id: str) -> dict[str, Any]:
    """At-most-once-per-UTC-date login XP. Uses the user's date as event_id.

    Concurrency: idempotent via `season_xp_events` unique index. If a user
    sends two requests at 00:00:00.001 UTC, exactly one succeeds.
    """
    today = _utc_date_today()
    event_id = f"login:{user_id}:{today}"
    return await award_xp(
        user_id=user_id,
        amount=DAILY_LOGIN_XP,
        source="daily_login",
        event_id=event_id,
    )


# ─── Tier claim (atomic) ──────────────────────────────────────────────────
async def claim_tier(
    user_id: str, season_id: str, tier: int, track: str,
) -> dict[str, Any]:
    """Atomic claim. Race-safe: concurrent calls → exactly one 200, one 400.

    Steps:
      1. Validate tier number + track + season is active.
      2. Validate user has enough XP to be ELIGIBLE for this tier.
      3. If track == "premium" → require `premium_unlocked == True`.
      4. Atomic $addToSet via `find_one_and_update` with `claimed_*_tiers: {$ne: tier}`
         clause. If no document matched (already claimed → race) → 400.
      5. Apply the reward (TON credit / item insert / free_spin grant) atomically.
      6. Return updated progress + balance.
    """
    if tier < 1 or tier > TOTAL_TIERS:
        raise SeasonError("invalid_tier")
    if not validate_track(track):
        raise SeasonError("invalid_track")

    season = await seasons_col.find_one({"season_id": season_id}, {"_id": 0})
    if not season:
        raise SeasonError("season_not_found")
    if season.get("status") != "active":
        raise SeasonError("season_not_active")

    prog = await get_user_progress(user_id, season_id)
    user_xp = int(prog.get("xp") or 0)
    user_tier = tier_from_xp(user_xp)
    if user_tier < tier:
        raise SeasonError("tier_not_yet_unlocked")

    if track == "premium" and not bool(prog.get("premium_unlocked")):
        raise SeasonError("premium_not_unlocked")

    claimed_field = "claimed_free_tiers" if track == "free" else "claimed_premium_tiers"

    # ── Atomic flip — only one concurrent call can satisfy this filter ──
    flipped = await progress_col.find_one_and_update(
        {
            "user_id": user_id,
            "season_id": season_id,
            claimed_field: {"$ne": tier},
        },
        {
            "$addToSet": {claimed_field: tier},
            "$set": {"updated_at": iso(now())},
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not flipped:
        raise SeasonError("already_claimed")

    # ── Resolve reward(s) from the season's tier_rewards table ─────────
    tier_row = next((t for t in season["tier_rewards"] if int(t["tier"]) == tier), None)
    if not tier_row:
        # Should never happen — but if it did, we'd have flipped without payout.
        # Roll back the claim.
        await progress_col.update_one(
            {"user_id": user_id, "season_id": season_id},
            {"$pull": {claimed_field: tier}},
        )
        raise SeasonError("tier_reward_missing")

    rewards = tier_row.get("free_rewards" if track == "free" else "premium_rewards") or []
    granted = await _apply_rewards(user_id, rewards)

    # Fetch fresh balance for caller convenience
    user_after = await users_col.find_one(
        {"id": user_id},
        {"_id": 0, "balance_ton": 1, "free_spin_tokens": 1},
    )
    return {
        "tier": tier,
        "track": track,
        "rewards_granted": granted,
        "progress": hydrate_progress(flipped),
        "balance_ton": float(user_after.get("balance_ton") or 0.0) if user_after else 0.0,
        "free_spin_tokens": int(user_after.get("free_spin_tokens") or 0) if user_after else 0,
    }


async def _apply_rewards(user_id: str, rewards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply a list of rewards atomically. Returns the granted list for the response."""
    granted: list[dict[str, Any]] = []
    for r in rewards:
        rtype = r.get("type")
        if rtype == "ton":
            amount = float(r.get("amount_ton") or 0.0)
            if amount > 0:
                await users_col.update_one(
                    {"id": user_id},
                    {"$inc": {"balance_ton": amount},
                     "$set": {"updated_at": iso(now())}},
                )
                granted.append({"type": "ton", "amount_ton": amount})
        elif rtype == "free_spin":
            count = int(r.get("count") or 1)
            if count > 0:
                await users_col.update_one(
                    {"id": user_id},
                    {"$inc": {"free_spin_tokens": count},
                     "$set": {"updated_at": iso(now())}},
                )
                granted.append({"type": "free_spin", "count": count})
        elif rtype == "item":
            slug = r.get("item_slug")
            if not slug:
                continue
            item_doc = await items_col.find_one({"slug": slug}, {"_id": 0})
            if not item_doc:
                LOG.warning("season: tier reward item missing slug=%s — skipping", slug)
                continue
            inv_id = secrets.token_hex(12)
            floor = float(item_doc.get("floor_price_ton") or 0.0)
            await inventory_col.insert_one({
                "id": inv_id,
                "user_id": user_id,
                "item_slug": slug,
                "item_name": item_doc.get("name", slug),
                "rarity": item_doc.get("rarity", "common"),
                "image_path": item_doc.get("image_path", f"items/{slug}.png"),
                "payout_ton": floor,
                "status": "in_inventory",
                "case_id": "battlepass",
                "roll_id": f"bp_{inv_id}",
                "source": "battlepass",
                "created_at": iso(now()),
            })
            granted.append({
                "type": "item",
                "item_slug": slug,
                "item_name": item_doc.get("name", slug),
                "rarity": item_doc.get("rarity", "common"),
                "image_path": item_doc.get("image_path", f"items/{slug}.png"),
                "floor_ton": floor,
                "inventory_id": inv_id,
            })
    return granted


# ─── Premium unlock (atomic) ──────────────────────────────────────────────
async def unlock_premium(user_id: str, season_id: str) -> dict[str, Any]:
    """Atomic 50 TON debit + flip `premium_unlocked` → True.

    Race-safety: two concurrent calls → only one debits + flips. The second
    matches against `premium_unlocked: {$ne: True}` and finds no doc → 400.
    """
    season = await seasons_col.find_one({"season_id": season_id}, {"_id": 0})
    if not season:
        raise SeasonError("season_not_found")
    if season.get("status") != "active":
        raise SeasonError("season_not_active")

    prog = await get_user_progress(user_id, season_id)
    if bool(prog.get("premium_unlocked")):
        raise SeasonError("already_unlocked")

    # 1. Atomic debit
    debit_cost = float(season.get("premium_unlock_ton") or PREMIUM_UNLOCK_TON)
    debited = await users_col.find_one_and_update(
        {"id": user_id, "balance_ton": {"$gte": debit_cost}},
        {"$inc": {"balance_ton": -debit_cost},
         "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "balance_ton": 1},
    )
    if not debited:
        raise SeasonError("insufficient_balance")

    # 2. Atomic flag flip (with race guard)
    flipped = await progress_col.find_one_and_update(
        {"user_id": user_id, "season_id": season_id, "premium_unlocked": {"$ne": True}},
        {"$set": {"premium_unlocked": True, "unlocked_at": iso(now()),
                  "updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not flipped:
        # Race lost — refund the debit
        await users_col.update_one(
            {"id": user_id},
            {"$inc": {"balance_ton": debit_cost},
             "$set": {"updated_at": iso(now())}},
        )
        raise SeasonError("already_unlocked_race")

    return {
        "premium_unlocked": True,
        "debited_ton": debit_cost,
        "balance_ton": float(debited.get("balance_ton") or 0.0),
        "progress": hydrate_progress(flipped),
    }


# ─── Leaderboard ──────────────────────────────────────────────────────────
async def get_leaderboard(season_id: str, limit: int = 50) -> list[dict[str, Any]]:
    cur = progress_col.find(
        {"season_id": season_id},
        {"_id": 0, "user_id": 1, "xp": 1, "premium_unlocked": 1},
    ).sort("xp", -1).limit(limit)
    rows = [d async for d in cur]
    # Hydrate with usernames + photo_urls
    uids = list({r["user_id"] for r in rows})
    user_map: dict[str, dict] = {}
    if uids:
        async for u in users_col.find(
            {"id": {"$in": uids}},
            {"_id": 0, "id": 1, "username": 1, "first_name": 1, "photo_url": 1},
        ):
            user_map[u["id"]] = u
    out: list[dict[str, Any]] = []
    for r in rows:
        u = user_map.get(r["user_id"], {})
        xp = int(r.get("xp") or 0)
        out.append({
            "user_id": r["user_id"],
            "username": u.get("username"),
            "first_name": u.get("first_name"),
            "photo_url": u.get("photo_url"),
            "xp": xp,
            "current_tier": tier_from_xp(xp),
            "premium_unlocked": bool(r.get("premium_unlocked")),
        })
    return out


# ─── Admin helpers ────────────────────────────────────────────────────────
async def force_end_season(season_id: str) -> dict[str, Any]:
    flipped = await seasons_col.find_one_and_update(
        {"season_id": season_id, "status": "active"},
        {"$set": {"status": "frozen", "frozen_at": iso(now()),
                  "force_ended": True}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not flipped:
        raise SeasonError("season_not_active")
    LOG.warning("[season] force-ended %s by admin", season_id)
    # Immediately bootstrap the next one
    next_idx = (int(flipped.get("index") or 1)) + 1
    new = await _create_season(starts_at=now(), index=next_idx)
    return {"frozen": flipped, "next": new}


async def patch_tier_rewards(season_id: str, tier_rewards: list[dict[str, Any]]) -> dict[str, Any]:
    """Admin: replace the tier_rewards array (for upcoming tiers only).

    Safety: we cannot mutate tiers that have already been claimed by ANY user
    on either track. We compute the highest such tier and only allow patching
    tiers strictly above it.
    """
    season = await seasons_col.find_one({"season_id": season_id}, {"_id": 0})
    if not season:
        raise SeasonError("season_not_found")

    # Highest tier claimed by anyone (free OR premium)
    highest = 0
    async for p in progress_col.find(
        {"season_id": season_id},
        {"_id": 0, "claimed_free_tiers": 1, "claimed_premium_tiers": 1},
    ):
        for t in (p.get("claimed_free_tiers") or []) + (p.get("claimed_premium_tiers") or []):
            try:
                highest = max(highest, int(t))
            except (TypeError, ValueError):
                continue

    # Build a merged ladder: keep existing rows ≤ highest, replace > highest with payload
    new_ladder: list[dict[str, Any]] = []
    by_tier = {int(t["tier"]): t for t in tier_rewards}
    for old in season["tier_rewards"]:
        tier_n = int(old["tier"])
        if tier_n <= highest:
            new_ladder.append(old)            # frozen — already claimed by someone
        elif tier_n in by_tier:
            row = by_tier[tier_n]
            new_ladder.append({
                "tier": tier_n,
                "xp_required": int(row.get("xp_required") or cumulative_xp_for_tier(tier_n)),
                "free_rewards": list(row.get("free_rewards") or []),
                "premium_rewards": list(row.get("premium_rewards") or []),
            })
        else:
            new_ladder.append(old)

    await seasons_col.update_one(
        {"season_id": season_id},
        {"$set": {"tier_rewards": new_ladder, "updated_at": iso(now())}},
    )
    fresh = await seasons_col.find_one({"season_id": season_id}, {"_id": 0})
    return {"season": fresh, "frozen_below_or_eq": highest}


# Public re-exports
__all__ = [
    "SeasonError",
    "PREMIUM_UNLOCK_TON",
    "DAILY_LOGIN_XP",
    "REFERRAL_FIRST_DEPOSIT_XP",
    "TOTAL_TIERS",
    "ensure_indexes",
    "get_or_create_active_season",
    "get_user_progress",
    "hydrate_progress",
    "award_xp",
    "maybe_award_daily_login",
    "claim_tier",
    "unlock_premium",
    "rollover_if_needed",
    "force_end_season",
    "patch_tier_rewards",
    "get_leaderboard",
    "tier_from_xp",
    "xp_for_tier",
    "cumulative_xp_for_tier",
]
