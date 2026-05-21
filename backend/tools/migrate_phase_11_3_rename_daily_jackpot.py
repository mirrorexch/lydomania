#!/usr/bin/env python3
"""Phase 11.3 — DB migration. Idempotent.

Changes applied to the live database:

  1. items: rename slug `daily_jackpot` → `lucky_coin`, set name to
     "Lucky Coin", and repoint image_path → items/lucky_coin.png.
     (The PNG file itself is renamed by `git mv` in the same commit, so
     the asset URL `/api/static/items/lucky_coin.png` resolves after
     this migration runs.)

  2. items: bump `lucky_ticket.floor_price_ton` 0.75 → 1.50 TON. Below
     1 TON on a 5 TON wheel spin reads as "scam" even when the maths is
     fair, so we lift it into the LOW-tier band (≥ 1 T).

  3. wheel_segments: wipe the cached segments collection so the next call
     to /api/wheel/config re-seeds it from the freshly updated
     SEGMENT_DEFS in core/wheel_engine.py (24 segments, total weight 192,
     RTP = 92.4 %, 50/50 split between ton_multi and item segments,
     token_dust + coin_flip removed from the wheel, daily_jackpot →
     lucky_coin renamed at the slug level).

  4. inventory: any existing user-owned `daily_jackpot` items get their
     `item_slug` and `image_path` repointed too, so a player who already
     won one before this migration still sees it correctly in their
     inventory page after deploy.

Run on prod EXACTLY ONCE after the Phase 11.3 deploy:

    docker compose exec backend python -m tools.migrate_phase_11_3_rename_daily_jackpot

The script is idempotent — running it twice is a no-op (the second
pass finds no `daily_jackpot` slug left to rename and reports 0 docs
touched).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("phase_11_3_migration")


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        LOG.error("MONGO_URL env var is not set — aborting")
        return 1
    db_name = os.environ.get("DB_NAME", "lydomania")
    cli = AsyncIOMotorClient(mongo_url)
    db = cli[db_name]
    LOG.info("connected · db=%s", db_name)

    # ── 1. items: rename daily_jackpot → lucky_coin ─────────────────────
    res_item = await db["items"].update_one(
        {"slug": "daily_jackpot"},
        {"$set": {
            "slug": "lucky_coin",
            "name": "Lucky Coin",
            "image_path": "items/lucky_coin.png",
        }},
    )
    LOG.info("[items] daily_jackpot → lucky_coin renamed: matched=%d modified=%d",
             res_item.matched_count, res_item.modified_count)

    # ── 2. items: lucky_ticket floor bump 0.75 → 1.50 ───────────────────
    res_ticket = await db["items"].update_one(
        {"slug": "lucky_ticket"},
        {"$set": {"floor_price_ton": 1.50}},
    )
    LOG.info("[items] lucky_ticket floor 0.75 → 1.50 TON: matched=%d modified=%d",
             res_ticket.matched_count, res_ticket.modified_count)

    # ── 3. wheel_segments: wipe so the new SEGMENT_DEFS get lazy-seeded ─
    res_segs = await db["wheel_segments"].delete_many({})
    LOG.info("[wheel_segments] purged %d stale segment docs (will re-seed on next /api/wheel/config)",
             res_segs.deleted_count)

    # ── 4. inventory: repoint any user-owned daily_jackpot items ────────
    res_inv = await db["inventory"].update_many(
        {"item_slug": "daily_jackpot"},
        {"$set": {
            "item_slug": "lucky_coin",
            "item_name": "Lucky Coin",
            "image_path": "items/lucky_coin.png",
        }},
    )
    LOG.info("[inventory] repointed %d user-owned daily_jackpot rows", res_inv.modified_count)

    # ── 5. roulette baskets (if any reference daily_jackpot) ────────────
    # Roulette pools might reference items by slug too — only touch them if
    # the field exists. This is a soft-defensive sweep.
    res_baskets = await db["roulette_baskets"].update_many(
        {"basket.slug": "daily_jackpot"},
        {"$set": {"basket.$[el].slug": "lucky_coin"}},
        array_filters=[{"el.slug": "daily_jackpot"}],
    )
    LOG.info("[roulette_baskets] repointed %d basket entries", res_baskets.modified_count)

    LOG.info("Phase 11.3 migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
