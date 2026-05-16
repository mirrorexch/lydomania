"""Phase 3c — Admin maintenance endpoints (Sync All button, recalibration)."""
from __future__ import annotations

from typing import Any

from fastapi import Body, Depends, Query

from core.auth import get_admin_user
from routers.admin import admin
from services.digest import send_sync_summary_dm
from services.floor_watcher import watch_once
from services.recalibration import (
    recalibrate_all_cases, recalibrate_case, sync_floors_to_items,
)
from services.settings import get_settings


@admin.post("/maintenance/sync-floors-from-fragment")
async def sync_floors_from_fragment(
    refresh_first: bool = Query(True, description="If true, trigger a live watch cycle before syncing."),
    apply: bool = Query(True, description="If false, returns a dry-run diff."),
) -> dict[str, Any]:
    """Refresh live floors via the watcher, then copy floor_ton → items.floor_price_ton."""
    watch_summary: dict[str, Any] = {"skipped": True, "reason": "refresh_first=false"}
    if refresh_first:
        watch_summary = await watch_once()
    sync_summary = await sync_floors_to_items(apply=apply)
    return {"watch": watch_summary, "items": sync_summary}


@admin.post("/maintenance/recalibrate-all-cases")
async def recalibrate_all(
    apply: bool = Query(True),
    max_payout_multiplier: float = Query(None, ge=10, le=10000),
    min_basket_size: int = Query(4, ge=2, le=64),
) -> dict[str, Any]:
    """Recalibrate every enabled case using live floors, with the user-configurable cap."""
    settings = await get_settings()
    mp = float(max_payout_multiplier if max_payout_multiplier is not None
               else settings.get("max_payout_multiplier", 200.0))
    return await recalibrate_all_cases(
        max_payout_multiplier=mp, min_basket_size=min_basket_size, apply=apply,
    )


@admin.post("/maintenance/recalibrate-case/{case_id}")
async def recalibrate_one(
    case_id: str,
    apply: bool = Query(True),
    max_payout_multiplier: float = Query(None, ge=10, le=10000),
    min_basket_size: int = Query(4, ge=2, le=64),
) -> dict[str, Any]:
    settings = await get_settings()
    mp = float(max_payout_multiplier if max_payout_multiplier is not None
               else settings.get("max_payout_multiplier", 200.0))
    return await recalibrate_case(
        case_id, max_payout_multiplier=mp, min_basket_size=min_basket_size, apply=apply,
    )


@admin.post("/maintenance/sync-all")
async def sync_all(
    apply: bool = Query(True, description="If false, returns a full dry-run diff."),
    refresh_first: bool = Query(True, description="If false, skip the watch_once cycle (uses cached live floors)."),
    max_payout_multiplier: float = Query(None, ge=10, le=10000),
    min_basket_size: int = Query(4, ge=2, le=64),
    dm_summary: bool = Query(True, description="DM the triggering admin a digest of the result."),
    admin_user: dict = Depends(get_admin_user),
) -> dict[str, Any]:
    """One-button: refresh floors → sync items → recalibrate cases.

    Set refresh_first=false to skip the ~37s Fragment scrape when floors are already fresh.
    If `dm_summary=true` (default) and the calling admin has a telegram_id, also queues a
    compact digest DM (Phase 4a).
    Returns a comprehensive report.
    """
    settings = await get_settings()
    mp = float(max_payout_multiplier if max_payout_multiplier is not None
               else settings.get("max_payout_multiplier", 200.0))
    watch = await watch_once() if refresh_first else {"skipped": True, "reason": "refresh_first=false"}
    items_sync = await sync_floors_to_items(apply=apply)
    cases_recalib = await recalibrate_all_cases(
        max_payout_multiplier=mp, min_basket_size=min_basket_size, apply=apply,
    )
    report = {
        "applied": apply,
        "max_payout_multiplier": mp,
        "watch": watch,
        "items_sync": items_sync,
        "cases_recalib": cases_recalib,
    }
    if dm_summary and admin_user.get("telegram_id"):
        try:
            await send_sync_summary_dm(int(admin_user["telegram_id"]), report)
            report["dm_sent_to"] = int(admin_user["telegram_id"])
        except Exception as e:
            report["dm_error"] = str(e)
    return report
