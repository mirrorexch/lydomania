"""Admin floor-prices stats with drift table (Phase 3b)."""
from __future__ import annotations

from typing import Any

from fastapi import Query

from core.db import gift_floor_prices_col, items_col
from routers.admin import admin
from services.floor_watcher import watch_once


@admin.get("/floor-prices/stats")
async def admin_floor_prices_stats(
    only_drift_pct: float = Query(0, ge=0, description="If >0, return only items whose absolute drift exceeds this %"),
) -> dict[str, Any]:
    items: dict[str, dict] = {}
    async for i in items_col.find({}, {"_id": 0, "slug": 1, "name": 1, "rarity": 1, "floor_price_ton": 1}):
        items[i["slug"]] = i
    floors: dict[str, dict] = {}
    async for d in gift_floor_prices_col.find({}, {"_id": 0}):
        floors[d["slug"]] = d
    rows: list[dict[str, Any]] = []
    for slug, item in items.items():
        f = floors.get(slug, {})
        live = float(f.get("floor_ton")) if f.get("floor_ton") is not None else None
        configured = float(item.get("floor_price_ton") or 0)
        drift_pct = None
        if live is not None and configured > 0:
            drift_pct = round((live - configured) / configured * 100.0, 2)
        if only_drift_pct > 0 and (drift_pct is None or abs(drift_pct) < only_drift_pct):
            continue
        rows.append({
            "slug": slug,
            "name": item.get("name"),
            "rarity": item.get("rarity"),
            "configured_floor_ton": configured,
            "live_floor_ton": live,
            "drift_pct": drift_pct,
            "source": f.get("source"),
            "updated_at": f.get("updated_at"),
            "last_status": f.get("last_status"),
        })
    # Sort by absolute drift desc, putting None drifts last
    rows.sort(key=lambda r: (r["drift_pct"] is None, -abs(r["drift_pct"] or 0)))
    return {
        "rows": rows,
        "summary": {
            "items_total": len(items),
            "items_with_floor": len(floors),
            "items_with_floor_ok": sum(1 for f in floors.values() if f.get("floor_ton") is not None),
            "items_drift_over_20pct": sum(1 for r in rows if r["drift_pct"] is not None and abs(r["drift_pct"]) >= 20),
        },
    }


@admin.post("/floor-prices/refresh-now")
async def admin_floor_prices_refresh() -> dict[str, Any]:
    """Manually kick off one floor-watcher cycle (does NOT alter the scheduled loop)."""
    return await watch_once()
