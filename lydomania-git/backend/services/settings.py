"""App settings singleton (Phase 3a)."""
from __future__ import annotations

from typing import Any

from core.db import settings_col
from core.time_utils import iso, now

SETTINGS_ID = "global"

DEFAULTS: dict[str, Any] = {
    "id": SETTINGS_ID,
    "use_live_portals_pricing": False,
    "portals_auth_data_enc": None,  # encrypted blob — never returned raw
    "floor_watcher_enabled": True,
    "floor_watcher_interval_seconds": 300,
    "auto_fulfill_enabled": False,
    "auto_fulfill_threshold_ton": 0.0,
    "auto_fulfill_daily_cap_ton": 100.0,
    "referral_bronze_pct": 5.0,
    "referral_silver_pct": 7.0,
    "referral_silver_threshold": 10,
    "referral_gold_pct": 10.0,
    "referral_gold_threshold": 50,
    "self_referral_blocked": True,
    "max_referrals_per_day_per_user": 20,
    # Phase 3c — solvency cap
    "max_payout_multiplier": 200.0,
    # Phase 4a — digest cron
    "digest_hour_utc": 9,
    "digest_last_sent_at": None,
    "digest_last_sent_stats": None,
    # Phase 4b — Portals client mode
    "portals_client_mode": "mock",
    "mock_portals_fail_rate": 0.0,
    "mock_portals_sim_delay_s": 0.05,
}


async def get_settings() -> dict[str, Any]:
    """Get-or-create settings doc with defaults filled in for any missing keys."""
    doc = await settings_col.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if not doc:
        doc = {**DEFAULTS, "created_at": iso(now())}
        await settings_col.insert_one(doc)
    # Backfill any missing keys (so newer settings appear without manual migration)
    missing = {k: v for k, v in DEFAULTS.items() if k not in doc}
    if missing:
        await settings_col.update_one({"id": SETTINGS_ID}, {"$set": missing})
        doc.update(missing)
    return doc


async def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    if not patch:
        return await get_settings()
    patch = {**patch, "updated_at": iso(now())}
    await settings_col.update_one({"id": SETTINGS_ID}, {"$set": patch}, upsert=True)
    return await get_settings()
