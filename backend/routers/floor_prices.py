"""Public-ish floor-prices endpoint (Phase 3b)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from core.db import gift_floor_prices_col

router = APIRouter(prefix="/api")


@router.get("/floor-prices")
async def floor_prices(slug: str | None = Query(None)) -> dict[str, Any]:
    """Returns {slug: {floor_ton, source, updated_at}} or single-item dict."""
    q: dict[str, Any] = {}
    if slug:
        q["slug"] = slug
    out: dict[str, Any] = {}
    async for d in gift_floor_prices_col.find(q, {"_id": 0}):
        if d.get("floor_ton") is None:
            continue
        out[d["slug"]] = {
            "floor_ton": float(d["floor_ton"]),
            "source": d.get("source", "fragment"),
            "updated_at": d.get("updated_at"),
        }
    if slug:
        return out.get(slug, {})
    return out
