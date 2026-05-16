"""Portals marketplace mock client (Phase 0 smoke; Phase 3b adds real client)."""
from __future__ import annotations

import json
from typing import Optional

import httpx
from core.config import logger

_PORTALS_MOCK = [
    {"name": "Plush Pepe", "price_ton": 12.5, "image": "https://nft.fragment.com/gift/plushpepe.lg.jpg", "source": "mock"},
    {"name": "Diamond Ring", "price_ton": 8.2, "image": "https://nft.fragment.com/gift/diamondring.lg.jpg", "source": "mock"},
    {"name": "Astral Shard", "price_ton": 45.0, "image": "https://nft.fragment.com/gift/astralshard.lg.jpg", "source": "mock"},
    {"name": "Heart Locket", "price_ton": 6.7, "image": "https://nft.fragment.com/gift/heartlocket.lg.jpg", "source": "mock"},
    {"name": "Loot Bag", "price_ton": 18.9, "image": "https://nft.fragment.com/gift/lootbag.lg.jpg", "source": "mock"},
]


async def try_real_listings(limit: int) -> Optional[list[dict]]:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            for path, parse in (
                ("/market/activity", lambda j: j.get("activities") or j.get("data") or j),
                ("/collections", lambda j: j.get("collections") or j),
            ):
                try:
                    r = await client.get(
                        f"https://portals-market.com/api{path}",
                        params={"limit": limit, "offset": 0},
                        headers={"User-Agent": "Mozilla/5.0 Lydomania/0.1"},
                    )
                except httpx.HTTPError:
                    continue
                if r.status_code != 200:
                    continue
                try:
                    j = r.json()
                except json.JSONDecodeError:
                    continue
                items = parse(j)
                if isinstance(items, list) and items:
                    out = []
                    for it in items[:limit]:
                        out.append({
                            "name": str(it.get("name") or it.get("title") or it.get("collection") or "Gift"),
                            "price_ton": float(it.get("price") or it.get("floor_price") or 0),
                            "image": it.get("image") or it.get("photo") or it.get("preview"),
                            "source": "portals",
                        })
                    return out
    except Exception as e:
        logger.warning("Portals real fetch failed: %s", e)
    return None


def mock_listings(limit: int) -> list[dict]:
    return _PORTALS_MOCK[:limit]
