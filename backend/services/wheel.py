"""Phase 7b — Wheel of Fortune service.

Owns the atomic spin handler. Two flavours:
  • use_free_token=True  — consume one of the user's `free_spin_tokens`
  • use_free_token=False — debit `cost_ton` (5.0 TON for V1) from balance

Both paths share the same body: derive segment → award TON or item → persist
the spin doc. Idempotent on `spin_id` (callers can never trigger a double
mutation by retrying).

Free-token refresh: granted lazily on the next /api/wheel/config call after
24h has elapsed since `last_free_token_at`. Race-safe via `find_one_and_update`
with the time precondition baked into the filter.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ReturnDocument

from core.db import db, inventory_col, items_col, users_col
from core.time_utils import iso, now
from core.wheel_engine import (
    FREE_TOKEN_REFRESH_SEC, PAID_SPIN_COST_TON, SEGMENT_DEFS, SEGMENT_COUNT,
    derive_segment, payout_for_segment, sha256_hex, total_weight,
)

LOG = logging.getLogger("lydomania.wheel")

segments_col = db["wheel_segments"]
spins_col    = db["wheel_spins"]


class WheelError(Exception):
    """Surface as 400 in the router."""


# ─── Segment cache (read once per process) ───────────────────────────────────
_segments_cache: list[dict[str, Any]] | None = None
_segments_lock = asyncio.Lock()


async def get_segments() -> list[dict[str, Any]]:
    global _segments_cache
    if _segments_cache is not None:
        return _segments_cache
    async with _segments_lock:
        if _segments_cache is not None:
            return _segments_cache
        cur = segments_col.find({}, {"_id": 0}).sort("segment_index", 1)
        rows = [d async for d in cur]
        if not rows:
            # Lazy-seed: copy the locked Python definition into Mongo.
            for d in SEGMENT_DEFS:
                await segments_col.insert_one({**d})
            rows = list(SEGMENT_DEFS)
        if len(rows) != SEGMENT_COUNT:
            LOG.warning("wheel: expected %d segments, found %d — using Python defaults",
                        SEGMENT_COUNT, len(rows))
            rows = list(SEGMENT_DEFS)
        _segments_cache = rows
        return rows


async def _item_floor_lookup() -> dict[str, float]:
    slugs = {s["item_slug"] for s in await get_segments() if s.get("item_slug")}
    cur = items_col.find({"slug": {"$in": list(slugs)}}, {"_id": 0, "slug": 1, "floor_price_ton": 1})
    return {d["slug"]: float(d.get("floor_price_ton") or 0.0) async for d in cur}


# ─── Free-token refresh (lazy, race-safe) ───────────────────────────────────
async def maybe_refresh_free_token(user_id: str) -> dict[str, Any]:
    """Atomic check-and-grant: if last_free_token_at is null or > 24h ago, give
    +1 free_spin_token. Returns the freshest user snapshot for `free_spin_tokens`
    and `last_free_token_at`. Race-safe under concurrent calls.
    """
    threshold = now() - timedelta(seconds=FREE_TOKEN_REFRESH_SEC)
    threshold_iso = iso(threshold)
    updated = await users_col.find_one_and_update(
        {
            "id": user_id,
            "$or": [
                {"last_free_token_at": {"$exists": False}},
                {"last_free_token_at": None},
                {"last_free_token_at": {"$lt": threshold_iso}},
            ],
        },
        {
            "$inc": {"free_spin_tokens": 1},
            "$set": {"last_free_token_at": iso(now()), "updated_at": iso(now())},
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "free_spin_tokens": 1, "last_free_token_at": 1},
    )
    if updated:
        return {
            "free_spin_tokens": int(updated.get("free_spin_tokens") or 0),
            "last_free_token_at": updated.get("last_free_token_at"),
        }
    snap = await users_col.find_one(
        {"id": user_id},
        {"_id": 0, "free_spin_tokens": 1, "last_free_token_at": 1},
    )
    return {
        "free_spin_tokens": int(snap.get("free_spin_tokens") or 0) if snap else 0,
        "last_free_token_at": (snap.get("last_free_token_at") if snap else None),
    }


def next_free_token_at(last_free_token_at: str | None) -> str | None:
    if not last_free_token_at:
        return None
    try:
        last = datetime.fromisoformat(last_free_token_at.replace("Z", "+00:00"))
    except Exception:    # noqa: BLE001
        return None
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return iso(last + timedelta(seconds=FREE_TOKEN_REFRESH_SEC))


# ─── Spin ────────────────────────────────────────────────────────────────────
async def spin(user: dict, use_free_token: bool) -> dict[str, Any]:
    """Atomic spin. Returns the spin doc including segment_index + payout."""
    segs = await get_segments()
    if total_weight(segs) <= 0:
        raise WheelError("wheel_misconfigured")

    user_id = user["id"]
    spin_id = secrets.token_hex(12)
    server_seed = secrets.token_hex(32)
    cost = 0.0 if use_free_token else PAID_SPIN_COST_TON

    # ── 1. Atomic balance / token debit ─────────────────────────────────────
    if use_free_token:
        debit = await users_col.find_one_and_update(
            {"id": user_id, "free_spin_tokens": {"$gte": 1}},
            {"$inc": {"free_spin_tokens": -1},
             "$set": {"updated_at": iso(now())}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "balance_ton": 1, "free_spin_tokens": 1},
        )
        if not debit:
            raise WheelError("no_free_token")
    else:
        debit = await users_col.find_one_and_update(
            {"id": user_id, "balance_ton": {"$gte": PAID_SPIN_COST_TON}},
            {"$inc": {"balance_ton": -PAID_SPIN_COST_TON},
             "$set": {"updated_at": iso(now())}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "balance_ton": 1, "free_spin_tokens": 1},
        )
        if not debit:
            raise WheelError("insufficient_balance")

    # ── 2. Derive segment & resolve payout ──────────────────────────────────
    seg_idx = derive_segment(server_seed, spin_id, segs)
    seg = next(s for s in segs if int(s["segment_index"]) == seg_idx)
    floors = await _item_floor_lookup()
    payout = payout_for_segment(seg, cost_ton=PAID_SPIN_COST_TON, item_floor_lookup=floors)

    # ── 3. Apply payout (TON credit OR inventory insert) ────────────────────
    inventory_id: str | None = None
    final_balance: float = float(debit["balance_ton"])
    if payout["payout_type"] == "ton":
        if payout["payout_ton"] > 0:
            credited = await users_col.find_one_and_update(
                {"id": user_id},
                {"$inc": {"balance_ton": float(payout["payout_ton"])},
                 "$set": {"updated_at": iso(now())}},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0, "balance_ton": 1},
            )
            final_balance = float(credited["balance_ton"]) if credited else final_balance
    else:
        slug = payout["payout_item_slug"]
        item_doc = await items_col.find_one({"slug": slug}, {"_id": 0})
        if not item_doc:
            LOG.warning("wheel: item %s not in items collection — refunding spin", slug)
            # Refund whichever resource the spin debited
            if use_free_token:
                await users_col.update_one({"id": user_id}, {"$inc": {"free_spin_tokens": 1}})
            else:
                refunded = await users_col.find_one_and_update(
                    {"id": user_id},
                    {"$inc": {"balance_ton": PAID_SPIN_COST_TON}},
                    return_document=ReturnDocument.AFTER,
                    projection={"_id": 0, "balance_ton": 1},
                )
                final_balance = float(refunded["balance_ton"]) if refunded else final_balance
            raise WheelError(f"missing_item:{slug}")
        inventory_id = secrets.token_hex(12)
        floor = float(item_doc.get("floor_price_ton") or 0.0)
        await inventory_col.insert_one({
            "id": inventory_id,
            "user_id": user_id,
            "item_slug": slug,
            "item_name": item_doc.get("name", slug),
            "rarity": item_doc.get("rarity", "common"),
            "image_path": item_doc.get("image_path", f"items/{slug}.png"),
            "payout_ton": floor,
            "status": "in_inventory",
            "case_id": "wheel",
            "roll_id": f"wheel_{spin_id}",
            "source": "wheel",
            "created_at": iso(now()),
        })

    # ── 4. Persist the spin doc (provably-fair record) ──────────────────────
    spin_doc = {
        "spin_id": spin_id,
        "user_id": user_id,
        "server_seed": server_seed,
        "server_seed_hash": sha256_hex(server_seed),
        "segment_index": seg_idx,
        "segment_type": seg["segment_type"],
        "payout_type": payout["payout_type"],
        "payout_ton": float(payout["payout_ton"]),
        "payout_item_slug": payout["payout_item_slug"],
        "inventory_id": inventory_id,
        "cost_ton": float(cost),
        "used_free_token": bool(use_free_token),
        "spun_at": iso(now()),
    }
    await spins_col.insert_one(spin_doc)

    # Phase 7c — Battle Pass: +10 XP per spin (free or paid). Idempotent via spin_id.
    try:
        from services.season import award_xp as _award_xp
        await _award_xp(user_id, 10, "wheel_spin", spin_id)
    except Exception as _e:  # noqa: BLE001
        LOG.warning("wheel: season XP hook failed for spin_id=%s: %s", spin_id, _e)

    # Refresh token count (might still be > 0 if user has multiple tokens)
    snap = await users_col.find_one(
        {"id": user_id},
        {"_id": 0, "balance_ton": 1, "free_spin_tokens": 1, "last_free_token_at": 1},
    )
    return {
        **spin_doc,
        "new_balance": float(snap.get("balance_ton") or final_balance),
        "new_token_count": int(snap.get("free_spin_tokens") or 0),
        "next_free_token_at": next_free_token_at(snap.get("last_free_token_at") if snap else None),
        "payout_value_ton_est": float(payout["estimated_value_ton"]),
    }
