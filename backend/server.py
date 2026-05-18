"""
Lydomania — slim FastAPI app shell.

Modules:
- core/*       — config, db, auth, ton, time_utils, models
- services/*   — notifications, deposit_watcher, settings, referral_ladder,
                 floor_watcher (stub), auto_fulfill (stub), portals
- routers/*    — auth, wallet, cases, fair, inventory, withdrawals, referrals,
                 share_card, internal, admin/*

server.py: app instance + lifespan + middleware + router includes + index/onboarding.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import STATIC_DIR, logger
from core.db import (
    cases_col, deposits_col, fair_col, intents_col, inventory_col, items_col,
    meta_col, notifications_col, pending_refs_col, ref_claims_col,
    ref_credits_col, rolls_col, users_col, withdrawals_col, settings_col,
    referral_abuse_col, gift_floor_prices_col, mongo_client,
)
from core.ton import VAULT_ADDR_B, VAULT_ADDR_NB
from core.config import TON_NETWORK
from routers.admin import admin as admin_router
from routers.auth import router as auth_router
from routers.cases import router as cases_router
from routers.fair import router as fair_router
from routers.floor_prices import router as floor_prices_router
from routers.leaderboard import router as leaderboard_router     # Phase 4b
from routers.promo import router as promo_router                  # Phase 4b
from routers.internal import router as internal_router
from routers.inventory import router as inventory_router
from routers.referrals import router as referrals_router
from routers.share_card import router as share_card_router
from routers.wallet import router as wallet_router
from routers.withdrawals import router as withdrawals_router
from services.auto_fulfill import auto_fulfill_loop
from services.deposit_watcher import deposit_watcher_loop
from services.digest import send_daily_digest_to_admins
from services.floor_watcher import floor_watcher_loop
from services.leaderboard import snapshot_previous_week
from services.settings import get_settings
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger


_background_tasks: list[asyncio.Task] = []
_scheduler: AsyncIOScheduler | None = None


async def _ensure_indexes() -> None:
    await users_col.create_index("telegram_id", unique=True)
    await users_col.create_index("id", unique=True)
    await intents_col.create_index([("user_id", 1), ("nonce", 1)])
    await intents_col.create_index("status")
    await deposits_col.create_index("tx_hash", unique=True)
    await meta_col.create_index("id", unique=True)
    await items_col.create_index("slug", unique=True)
    await cases_col.create_index("id", unique=True)
    await fair_col.create_index("user_id", unique=True)
    await rolls_col.create_index("id", unique=True)
    await rolls_col.create_index([("user_id", 1), ("nonce", 1)])
    await inventory_col.create_index("id", unique=True)
    await inventory_col.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    await withdrawals_col.create_index("id", unique=True)
    # Phase 1b
    await users_col.create_index("ref_code", unique=True, sparse=True)
    await pending_refs_col.create_index("telegram_id", unique=True)
    await pending_refs_col.create_index("expires_at", expireAfterSeconds=0)
    await ref_credits_col.create_index([("referrer_user_id", 1), ("created_at", -1)])
    await ref_claims_col.create_index([("user_id", 1), ("created_at", -1)])
    # Phase 2
    await notifications_col.create_index("id", unique=True)
    await notifications_col.create_index([("status", 1), ("created_at", 1)])
    await withdrawals_col.create_index([("status", 1), ("requested_at", -1)])
    # Phase 3a
    await settings_col.create_index("id", unique=True)
    await referral_abuse_col.create_index([("created_at", -1)])
    await gift_floor_prices_col.create_index("slug", unique=True)
    # Phase 6e — gift deposits
    from core.db import gift_deposit_intents_col, gift_deposits_col  # local import
    await gift_deposit_intents_col.create_index("id", unique=True)
    await gift_deposit_intents_col.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    await gift_deposit_intents_col.create_index("memo")
    await gift_deposits_col.create_index("tx_hash", unique=True)


async def _sync_static_bundle() -> None:
    """Defense-in-depth against the docker named-volume-overlay foot-gun.

    The `backend-static` named volume is mounted at /app/backend/static and
    masks any baked-in files inside that path. We keep a pristine copy at
    /app/backend/_static_bundle (outside the volume) and rsync any missing
    files into the live STATIC_DIR on startup. Safe to run every boot.

    Phase 6e bug-fix: previously this only copied MISSING files, which meant
    that when the bundled artwork changed (e.g. the 70 new Phase 6e PNGs),
    the stale 22 KB placeholders already on the live volume were never
    overwritten. We now compare (size, mtime) — different tuple → overwrite.
    Identical → skip (no-op on stable images).

    Files in the live volume that DON'T exist in the bundle are NEVER
    touched (we only walk the bundle), so user-uploaded admin assets are
    preserved.
    """
    import os as _os
    import shutil
    from pathlib import Path as _Path
    bundle = STATIC_DIR.parent / "_static_bundle"
    if not bundle.exists() or not bundle.is_dir():
        return  # no bundle baked in (dev / sandbox) — skip silently
    copied = 0
    skipped = 0
    for root, _dirs, files in _os.walk(bundle):
        rel = _Path(root).relative_to(bundle)
        dst_dir = STATIC_DIR / rel
        dst_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            src = _Path(root) / f
            dst = dst_dir / f
            try:
                src_stat = src.stat()
            except OSError as e:
                logger.warning("[static_sync] cannot stat bundle file %s: %s", src, e)
                continue
            if dst.exists():
                dst_stat = dst.stat()
                if (dst_stat.st_size == src_stat.st_size
                        and int(dst_stat.st_mtime) == int(src_stat.st_mtime)):
                    skipped += 1
                    continue
                logger.info(
                    "[static_sync] OVERWRITE %s bundle=%d live=%d",
                    str(rel / f), src_stat.st_size, dst_stat.st_size,
                )
            try:
                shutil.copy2(src, dst)
                copied += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("[static_sync] copy failed for %s: %s", f, e)
    if copied or skipped:
        logger.info("[static_sync] %d copied, %d already-current", copied, skipped)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Lydomania starting — vault=%s (UQ) / %s (EQ) network=%s",
        VAULT_ADDR_NB, VAULT_ADDR_B, TON_NETWORK,
    )
    await _sync_static_bundle()
    await _ensure_indexes()
    # Background tasks
    _background_tasks.append(asyncio.create_task(deposit_watcher_loop()))
    _background_tasks.append(asyncio.create_task(floor_watcher_loop()))
    _background_tasks.append(asyncio.create_task(auto_fulfill_loop()))
    # Phase 6e — Telegram NFT gift deposit watcher (no-op if ENABLE_GIFT_DEPOSITS=false or TONAPI_KEY unset)
    from services.gift_deposit_watcher import gift_deposit_watcher_loop  # noqa: E402
    _background_tasks.append(asyncio.create_task(gift_deposit_watcher_loop()))
    # Phase 6c — roulette engine (single global loop driving the round state machine)
    from services.roulette import engine as _roulette_engine
    await _roulette_engine.start()
    _background_tasks.append(_roulette_engine._loop_task)
    # Phase 6d — clean up battles caught mid-flight by a previous restart
    from services.battles import on_startup as _battles_on_startup
    await _battles_on_startup()
    # Phase 4a — daily digest cron (APScheduler)
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    try:
        settings = await get_settings()
        hour = int(settings.get("digest_hour_utc", 9))
        hour = max(0, min(23, hour))
    except Exception:
        hour = 9
    _scheduler.add_job(
        send_daily_digest_to_admins,
        CronTrigger(hour=hour, minute=0, timezone="UTC"),
        id="daily_digest", replace_existing=True,
        max_instances=1, coalesce=True, misfire_grace_time=3600,
    )
    # Phase 4b — weekly leaderboard snapshot cron (Mon 00:05 UTC, after weekly cutoff)
    _scheduler.add_job(
        snapshot_previous_week,
        CronTrigger(day_of_week="mon", hour=0, minute=5, timezone="UTC"),
        id="weekly_leaderboard_snapshot", replace_existing=True,
        max_instances=1, coalesce=True, misfire_grace_time=24 * 3600,
    )
    _scheduler.start()
    logger.info("APScheduler started · daily_digest cron at %02d:00 UTC · weekly_leaderboard_snapshot Mon 00:05 UTC", hour)
    try:
        yield
    finally:
        logger.info("Lydomania shutting down — cancelling %d background tasks", len(_background_tasks))
        if _scheduler:
            _scheduler.shutdown(wait=False)
        for t in _background_tasks:
            t.cancel()
        for t in _background_tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        mongo_client.close()


app = FastAPI(title="Lydomania API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Static files (item images, share cards, etc.)
app.mount("/api/static", StaticFiles(directory=STATIC_DIR), name="static")


# Register all routers
app.include_router(auth_router)
app.include_router(wallet_router)
app.include_router(cases_router)
app.include_router(fair_router)
app.include_router(inventory_router)
app.include_router(withdrawals_router)
app.include_router(referrals_router)
app.include_router(share_card_router)
app.include_router(floor_prices_router)
app.include_router(leaderboard_router)
app.include_router(promo_router)
app.include_router(internal_router)
app.include_router(admin_router)
# Phase 6c — Roulette
from routers.roulette import router as roulette_router  # noqa: E402
from routers.ws_roulette import router as roulette_ws_router  # noqa: E402
app.include_router(roulette_router)
app.include_router(roulette_ws_router)
# Phase 6d — Case Battles
from routers.battles import router as battles_router  # noqa: E402
from routers.ws_battles import router as battles_ws_router  # noqa: E402
app.include_router(battles_router)
app.include_router(battles_ws_router)
# Phase 6e — Telegram NFT gift deposits
from routers.gift_deposits import router as gift_deposits_router  # noqa: E402
from routers.admin.gift_deposits import router as admin_gift_deposits_router  # noqa: E402
app.include_router(gift_deposits_router)
app.include_router(admin_gift_deposits_router)
# Phase 6e — Roulette gift mode
from routers.admin.sell_reviews import router as admin_sell_reviews_router  # noqa: E402
from routers.admin.roulette_config import router as admin_roulette_config_router  # noqa: E402
app.include_router(admin_sell_reviews_router)
app.include_router(admin_roulette_config_router)
