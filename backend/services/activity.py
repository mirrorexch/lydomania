"""Phase 8 — Live Activity feed.

Broadcasts big wins via WebSocket + persists to a capped collection so
reconnects can hydrate via REST.

Threshold (configurable): multiplier ≥ 5× OR payout_ton ≥ 5 OR rare gift drop.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Any

from core.db import db, users_col
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.activity")

# Use a normal collection; "capped" is achieved by retention pruning every
# write (keep last 200). Cheap and avoids the special-flag dance Mongo
# requires for create_collection(capped=True).
activity_col = db["live_activity"]
MAX_KEEP = 200

# Thresholds
MIN_MULTIPLIER = 5.0
MIN_PAYOUT_TON = 5.0


class _Hub:
    """In-process WebSocket hub for live activity."""
    def __init__(self) -> None:
        self._sockets: set = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws) -> None:
        async with self._lock:
            self._sockets.add(ws)

    async def disconnect(self, ws) -> None:
        async with self._lock:
            self._sockets.discard(ws)

    def broadcast(self, payload: dict) -> None:
        dead = []
        for ws in list(self._sockets):
            try:
                # Send via task so we don't block hot path
                asyncio.create_task(ws.send_json(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._sockets.discard(ws)

    @property
    def count(self) -> int:
        return len(self._sockets)


hub = _Hub()


def _anonymize(username: str | None, telegram_id: int | str | None) -> str:
    if username:
        # Public username; keep first 4 chars + ellipsis
        if len(username) <= 4:
            return username
        return username[:4] + "…"
    s = str(telegram_id or "anon")
    return f"u{s[:4]}"


async def maybe_broadcast(
    user_id: str, *, game: str, kind: str,
    payout_ton: float = 0.0, multiplier: float | None = None,
    item_slug: str | None = None,
) -> dict[str, Any] | None:
    """Decide whether to broadcast + persist this win."""
    above_mult = (multiplier is not None and multiplier >= MIN_MULTIPLIER)
    above_payout = (payout_ton >= MIN_PAYOUT_TON)
    has_rare = bool(item_slug)  # we treat any gift as broadcast-worthy
    if not (above_mult or above_payout or has_rare):
        return None

    u = await users_col.find_one(
        {"id": user_id},
        {"_id": 0, "username": 1, "telegram_id": 1, "photo_url": 1, "first_name": 1},
    )
    if not u:
        return None
    handle = _anonymize(u.get("username") or u.get("first_name"), u.get("telegram_id"))

    doc = {
        "id": secrets.token_hex(10),
        "user_id": user_id,
        "user_handle": handle,
        "photo_url": u.get("photo_url"),
        "game": game,
        "kind": kind,
        "payout_ton": float(payout_ton or 0),
        "multiplier": float(multiplier) if multiplier is not None else None,
        "item_slug": item_slug,
        "created_at": iso(now()),
    }
    await activity_col.insert_one(dict(doc))

    # Trim oldest beyond MAX_KEEP
    total = await activity_col.count_documents({})
    if total > MAX_KEEP:
        excess = total - MAX_KEEP
        cur = activity_col.find({}, {"_id": 1}).sort("created_at", 1).limit(excess)
        ids = [d["_id"] async for d in cur]
        if ids:
            await activity_col.delete_many({"_id": {"$in": ids}})

    doc.pop("_id", None)
    hub.broadcast({"type": "activity", **doc})
    return doc


async def recent(limit: int = 20) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async for d in activity_col.find({}, {"_id": 0}).sort("created_at", -1).limit(limit):
        out.append(d)
    return out


async def top_24h(
    *, limit: int = 24,
    filter_mode: str = "all",        # all | big_mult | big_payout
    game_slug: str | None = None,
) -> list[dict[str, Any]]:
    """Phase 11 / Fix-K — Ranked Top Wins for the last 24h.

    Used by the new "Top Wins · Last 24h" home section. Reads from the
    same `live_activity` collection that the marquee ticker is fed from;
    no extra index assumed (collection stays ≤ 200 docs).
    """
    from datetime import timedelta as _td
    cutoff = iso(now() - _td(hours=24))
    q: dict = {"created_at": {"$gte": cutoff}}
    if filter_mode == "big_mult":
        q["multiplier"] = {"$gte": MIN_MULTIPLIER}
    elif filter_mode == "big_payout":
        q["payout_ton"] = {"$gte": 10.0}
    if game_slug:
        q["game"] = game_slug.lower()
    cur = activity_col.find(q, {"_id": 0})
    rows = [d async for d in cur]
    # Composite ranking: multiplier desc, then payout desc, then time desc.
    def _key(r):
        return (
            float(r.get("multiplier") or 0),
            float(r.get("payout_ton") or 0),
            r.get("created_at") or "",
        )
    rows.sort(key=_key, reverse=True)
    return rows[:limit]


# Phase 11.1 — Today's Jackpot counter for the home hero.
_JACKPOT_CACHE: dict = {"value": None, "expires_at": 0.0}


async def jackpot_24h() -> dict[str, Any]:
    """Sum of payout_ton across all live_activity events in the last 24h.

    5-second in-memory cache so the home hero counter + WS-driven
    re-fetches don't slam the DB on every websocket tick.
    """
    import time as _t
    nowm = _t.monotonic()
    cached = _JACKPOT_CACHE["value"]
    if cached is not None and nowm < _JACKPOT_CACHE["expires_at"]:
        return cached

    from datetime import timedelta as _td
    cutoff = iso(now() - _td(hours=24))
    cur = activity_col.find(
        {"created_at": {"$gte": cutoff}},
        {"_id": 0, "payout_ton": 1},
    )
    total = 0.0
    count = 0
    async for d in cur:
        total += float(d.get("payout_ton") or 0)
        count += 1
    result = {
        "jackpot_ton": round(total, 4),
        "sample_size": count,
        "since": cutoff,
    }
    _JACKPOT_CACHE["value"] = result
    _JACKPOT_CACHE["expires_at"] = nowm + 5.0
    return result
