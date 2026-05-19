"""Admin settings CRUD (Phase 3a)."""
from __future__ import annotations

from core.models import SettingsOut, SettingsPatchIn
from routers.admin import admin
from services.settings import get_settings, update_settings


def _doc_to_out(d: dict) -> SettingsOut:
    return SettingsOut(
        use_live_portals_pricing=bool(d.get("use_live_portals_pricing", False)),
        portals_auth_data_set=bool(d.get("portals_auth_data_fernet") or d.get("portals_auth_data_enc")),
        floor_watcher_enabled=bool(d.get("floor_watcher_enabled", True)),
        floor_watcher_interval_seconds=int(d.get("floor_watcher_interval_seconds", 300)),
        auto_fulfill_enabled=bool(d.get("auto_fulfill_enabled", False)),
        auto_fulfill_dry_run=bool(d.get("auto_fulfill_dry_run", True)),
        auto_fulfill_threshold_ton=float(d.get("auto_fulfill_threshold_ton", 0.0)),
        auto_fulfill_daily_cap_ton=float(d.get("auto_fulfill_daily_cap_ton", 100.0)),
        referral_bronze_pct=float(d.get("referral_bronze_pct", 5.0)),
        referral_silver_pct=float(d.get("referral_silver_pct", 7.0)),
        referral_silver_threshold=int(d.get("referral_silver_threshold", 10)),
        referral_gold_pct=float(d.get("referral_gold_pct", 10.0)),
        referral_gold_threshold=int(d.get("referral_gold_threshold", 50)),
        self_referral_blocked=bool(d.get("self_referral_blocked", True)),
        max_referrals_per_day_per_user=int(d.get("max_referrals_per_day_per_user", 20)),
        max_payout_multiplier=float(d.get("max_payout_multiplier", 200.0)),
        digest_hour_utc=int(d.get("digest_hour_utc", 9)),
        digest_last_sent_at=d.get("digest_last_sent_at"),
        digest_last_sent_stats=d.get("digest_last_sent_stats"),
        portals_client_mode=str(d.get("portals_client_mode") or "mock"),
        mock_portals_fail_rate=float(d.get("mock_portals_fail_rate") or 0.0),
        mock_portals_sim_delay_s=float(d.get("mock_portals_sim_delay_s") or 0.05),
    )


@admin.get("/settings", response_model=SettingsOut)
async def admin_get_settings() -> SettingsOut:
    return _doc_to_out(await get_settings())


@admin.patch("/settings", response_model=SettingsOut)
async def admin_patch_settings(patch: SettingsPatchIn) -> SettingsOut:
    return _doc_to_out(await update_settings(patch.model_dump(exclude_none=True)))
