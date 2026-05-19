"""Phase 4b — Admin digest live-preview endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import Query

from routers.admin import admin
from services.digest import build_daily_digest, build_sync_summary


@admin.get("/digest/preview")
async def admin_digest_preview(window_hours: int = Query(24, ge=1, le=720)) -> dict[str, Any]:
    """Return the same payload the daily cron would dispatch, on demand."""
    return await build_daily_digest(window_hours=window_hours)
