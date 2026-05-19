"""
Phase 3b — Fragment floor-price watcher (+ Phase 3c robust-floor enhancement).

Scrapes https://fragment.com/gifts/{slug} for the lowest TON listings.
Captures BOTH absolute floor (cheapest listing) AND robust floor
(median of the cheapest 5 listings) so case recalibration can use the
robust signal — outlier single listings (one-off cheap-bait) won't
dominate the basket payouts.

Runs every settings.floor_watcher_interval_seconds. Updates
`gift_floor_prices` and DMs admin if drift vs items.floor_price_ton
exceeds 20% (dedup'd to 1 DM per item per 6h).
"""
from __future__ import annotations

import asyncio
import re
import statistics
from typing import Optional

import httpx

from core.config import ADMIN_TELEGRAM_IDS, logger
from core.db import gift_floor_prices_col, items_col
from core.time_utils import iso, now
from services.notifications import enqueue_notification
from services.settings import get_settings

# Mirrors tools/fetch_base_gift_images.py
FRAGMENT_OVERRIDES = {"durov_cap": "durovscap", "westside_sign": "westsidesign", "tama_gadget": "tamagadget"}
DRIFT_DM_DEDUP_HOURS = 6
DRIFT_WARN_PCT = 20.0
ROBUST_SAMPLE = 5  # how many cheapest listings to median for "robust" floor


def fragment_slug(slug: str) -> str:
    return FRAGMENT_OVERRIDES.get(slug, slug.replace("_", "").lower())


# Only the GRID-ITEM price pattern (per-listing card price). Avoids generic
# tm-value matches which can pick up unrelated TON-iconed labels.
_GRID_PRICE_RE = re.compile(
    r'tm-grid-item-value[^>]*icon-ton[^>]*>\s*([\d,]+(?:\.\d+)?)\s*<',
    re.IGNORECASE,
)


def _parse_price(raw: str) -> float:
    return float(raw.replace(",", ""))


async def fetch_fragment_floor(client: httpx.AsyncClient, slug: str) -> dict:
    """Return {floor_ton, floor_ton_robust, listing_count, source}.

    floor_ton         – absolute cheapest listing (may be an outlier mis-price)
    floor_ton_robust  – median of the cheapest ROBUST_SAMPLE listings
    listing_count     – number of For-Sale grid-item prices parsed
    source            – 'fragment' if we got at least 1 price, else 'unavailable'
    """
    frag = fragment_slug(slug)
    url = f"https://fragment.com/gifts/{frag}?sort=price_asc&filter=sale"
    try:
        r = await client.get(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; LydomaniaBot/0.1; +https://t.me/lydomania777_bot)",
            "Accept": "text/html,application/xhtml+xml",
        })
    except httpx.HTTPError as e:
        logger.warning("floor-watcher fetch error %s: %s", slug, e)
        return {"floor_ton": None, "floor_ton_robust": None, "listing_count": 0, "source": "unavailable"}
    if r.status_code != 200 or not r.text:
        return {"floor_ton": None, "floor_ton_robust": None, "listing_count": 0, "source": "unavailable"}
    body = r.text

    prices: list[float] = []
    for raw in _GRID_PRICE_RE.findall(body):
        try:
            p = _parse_price(raw)
            if p > 0:
                prices.append(p)
        except ValueError:
            continue
    if not prices:
        return {"floor_ton": None, "floor_ton_robust": None, "listing_count": 0, "source": "unavailable"}

    prices.sort()
    floor_abs = prices[0]
    sample = prices[: min(ROBUST_SAMPLE, len(prices))]
    floor_robust = float(statistics.median(sample))
    return {
        "floor_ton": float(floor_abs),
        "floor_ton_robust": float(floor_robust),
        "listing_count": len(prices),
        "source": "fragment",
    }


async def _dm_admins(text: str, kind: str) -> None:
    for tid in ADMIN_TELEGRAM_IDS:
        await enqueue_notification(int(tid), text, kind=kind)


async def _maybe_warn_drift(item: dict, new_floor: float, baseline_floor: float) -> None:
    if baseline_floor <= 0:
        return
    drift_pct = (new_floor - baseline_floor) / baseline_floor * 100.0
    if abs(drift_pct) < DRIFT_WARN_PCT:
        return
    # Dedup: check last DM time
    fresh = await gift_floor_prices_col.find_one({"slug": item["slug"]}, {"_id": 0, "last_drift_dm_at": 1})
    last_dm = (fresh or {}).get("last_drift_dm_at")
    if last_dm:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(last_dm.replace("Z", "+00:00")) if isinstance(last_dm, str) else last_dm
            if (now() - dt).total_seconds() < DRIFT_DM_DEDUP_HOURS * 3600:
                return
        except Exception:
            pass
    direction = "📈 up" if drift_pct > 0 else "📉 down"
    msg = (
        f"⚠️ <b>Floor drift</b> · {item['name']}\n"
        f"Configured: {baseline_floor:.2f} TON\n"
        f"Live floor: <b>{new_floor:.2f} TON</b> ({direction} {abs(drift_pct):.1f}%)\n\n"
        f"Consider recalibrating payouts for cases using this item."
    )
    await _dm_admins(msg, kind="floor_drift")
    await gift_floor_prices_col.update_one(
        {"slug": item["slug"]},
        {"$set": {"last_drift_dm_at": iso(now())}},
    )


async def watch_once() -> dict:
    """Run a single watch cycle. Returns summary stats."""
    settings = await get_settings()
    if not settings.get("floor_watcher_enabled", True):
        return {"skipped": True, "reason": "disabled"}
    items: list[dict] = []
    async for i in items_col.find({}, {"_id": 0, "slug": 1, "name": 1, "floor_price_ton": 1}):
        items.append(i)
    if not items:
        return {"skipped": True, "reason": "no items"}
    ok = 0
    fail = 0
    started = now()
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        for item in items:
            slug = item["slug"]
            result = await fetch_fragment_floor(client, slug)
            floor = result["floor_ton"]
            floor_robust = result["floor_ton_robust"]
            listing_count = result["listing_count"]
            source = result["source"]
            now_iso = iso(now())
            if floor is None:
                await gift_floor_prices_col.update_one(
                    {"slug": slug},
                    {"$set": {"slug": slug, "updated_at": now_iso, "source": source, "last_status": "fail"}},
                    upsert=True,
                )
                fail += 1
                continue
            await gift_floor_prices_col.update_one(
                {"slug": slug},
                {"$set": {
                    "slug": slug, "name": item.get("name"),
                    "floor_ton": float(floor),
                    "floor_ton_robust": float(floor_robust),
                    "listing_count": int(listing_count),
                    "source": source,
                    "updated_at": now_iso, "last_status": "ok",
                }},
                upsert=True,
            )
            ok += 1
            await _maybe_warn_drift(item, float(floor), float(item.get("floor_price_ton") or 0))
            await asyncio.sleep(0.2)  # be polite
    duration = (now() - started).total_seconds()
    logger.info("floor-watcher cycle done · ok=%d fail=%d in %.1fs", ok, fail, duration)
    return {"ok": ok, "fail": fail, "total": len(items), "duration_s": round(duration, 1)}


async def floor_watcher_loop() -> None:
    logger.info("floor-watcher loop started")
    # Small startup delay so the FastAPI app is fully up before the first scrape.
    await asyncio.sleep(15)
    while True:
        try:
            s = await get_settings()
            interval = max(60, int(s.get("floor_watcher_interval_seconds", 300)))
            enabled = bool(s.get("floor_watcher_enabled", True))
            if enabled:
                await watch_once()
            else:
                logger.info("floor-watcher disabled by settings, sleeping %ds", interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("floor-watcher cycle error: %s", e)
        await asyncio.sleep(interval)
