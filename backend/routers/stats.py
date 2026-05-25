"""Phase 11.6-C — `/api/stats/online` endpoint.

Sliding-window "online users" counter. A user counts as online if they
have made any authenticated request within the last `ONLINE_WINDOW_SEC`
seconds. `last_seen` is stamped by the get_current_user dependency in
core/auth.py on every request.

In-memory cache prevents hammering MongoDB:
  - Bucket key resolves every 15 s → at most ~4 reads/min regardless of
    how many clients poll `/api/stats/online` concurrently.
  - Single MongoDB `count_documents` against a partial index on
    `last_seen` (created lazily in core/db.py if absent).
"""
from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any

from fastapi import APIRouter

from core.db import users_col
from core.time_utils import iso, now

router = APIRouter(prefix="/api/stats", tags=["stats"])

ONLINE_WINDOW_SEC = 5 * 60      # "online" = last_seen within 5 min
CACHE_TTL_SEC = 15              # response cached for 15 s

_cache_lock = asyncio.Lock()
_cache: dict[str, Any] = {"value": None, "expires_at": None}


async def _count_online() -> int:
    """Single Mongo round-trip — count users with last_seen within window."""
    cutoff = now() - dt.timedelta(seconds=ONLINE_WINDOW_SEC)
    return await users_col.count_documents({"last_seen": {"$gte": cutoff}})


@router.get("/online")
async def online_users() -> dict[str, Any]:
    """
    Return the number of users with `last_seen` within the last 5 minutes.

    Response:
        {
            "online":  <int>,
            "as_of":   <ISO-8601 UTC>,
            "window_sec": 300
        }
    """
    async with _cache_lock:
        n = now()
        if _cache["value"] is not None and _cache["expires_at"] is not None and _cache["expires_at"] > n:
            count = _cache["value"]
            as_of = _cache["as_of"]
        else:
            count = await _count_online()
            _cache["value"] = count
            _cache["as_of"] = iso(n)
            _cache["expires_at"] = n + dt.timedelta(seconds=CACHE_TTL_SEC)
            as_of = _cache["as_of"]
    return {"online": int(count), "as_of": as_of, "window_sec": ONLINE_WINDOW_SEC}
