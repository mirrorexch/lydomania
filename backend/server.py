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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Lydomania starting — vault=%s (UQ) / %s (EQ) network=%s",
        VAULT_ADDR_NB, VAULT_ADDR_B, TON_NETWORK,
    )
    await _ensure_indexes()
    # Background tasks
    _background_tasks.append(asyncio.create_task(deposit_watcher_loop()))
    _background_tasks.append(asyncio.create_task(floor_watcher_loop()))
    _background_tasks.append(asyncio.create_task(auto_fulfill_loop()))
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
