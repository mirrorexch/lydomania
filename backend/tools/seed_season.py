"""Phase 7c — Seed/refresh the first Battle Pass season.

Usage:
    python -m tools.seed_season           # idempotent — only creates if none active
    python -m tools.seed_season --reset   # close all + create a fresh one (DEV ONLY)

This is run automatically on backend startup via the lifespan hook; manual
invocation is only needed for sandbox reset.
"""
from __future__ import annotations

import asyncio
import sys

from core.db import db
from services.season import (
    ensure_indexes, get_or_create_active_season, rollover_if_needed,
)


seasons_col = db["seasons"]
progress_col = db["user_season_progress"]
xp_events_col = db["season_xp_events"]


async def main(reset: bool = False) -> None:
    await ensure_indexes()
    if reset:
        await seasons_col.delete_many({})
        await progress_col.delete_many({})
        await xp_events_col.delete_many({})
        print("[seed_season] wiped seasons + progress + xp events")
    # Auto-rollover anything past ends_at first (no-op on fresh DB)
    rolled = await rollover_if_needed()
    if rolled:
        print(f"[seed_season] auto-rolled forward into {rolled['season_id']}")
    active = await get_or_create_active_season()
    print(
        f"[seed_season] active season: {active['season_id']} "
        f"name='{active.get('name')}' ends_at={active['ends_at']} "
        f"tiers={len(active.get('tier_rewards', []))}",
    )


if __name__ == "__main__":
    flag = "--reset" in sys.argv
    asyncio.run(main(reset=flag))
