"""Rebuild every case basket into a competitor-style spread, calibrated to 90% RTP.

For each case (ticket price P) we pick a spread of REAL Telegram gifts from the
live Fragment floor pool across rarity bands (relative to P):

    common      0.5–1.5 P     (frequent, near-ticket consolation)
    uncommon    1.5–4   P
    rare        4–12    P
    epic        12–40   P
    legendary   40–150  P     (the jackpot; capped at 150× and at the catalog max)

Then weights are solved so the cheap items are common and the expensive ones rare
(weight ∝ exp(α·floor)), binary-searching α so EV == 0.90 × P exactly. Each item
carries its rarity label for UI colouring. Where the catalog can't fill a band
(very expensive cases), the spread compresses but RTP is still exactly 90%.

Idempotent: re-running rebuilds from current live floors.
Usage:  cd /app/backend && python -m tools.rebuild_competitive_cases
"""
from __future__ import annotations

import asyncio
import math
from typing import Any

from core.db import cases_col, gift_floor_prices_col, items_col

TARGET_RTP = 0.90
JACKPOT_CAP_MULT = 150.0
# (rarity, lo×P, hi×P, max items to take from this band)
BANDS = [
    ("common", 0.5, 1.5, 5),
    ("uncommon", 1.5, 4.0, 4),
    ("rare", 4.0, 12.0, 3),
    ("epic", 12.0, 40.0, 3),
    ("legendary", 40.0, JACKPOT_CAP_MULT, 2),
]
MIN_ITEMS = 6


async def _load_pool() -> list[dict[str, Any]]:
    pool: list[dict[str, Any]] = []
    async for g in gift_floor_prices_col.find(
        {"source": "fragment", "floor_ton": {"$gt": 0}}, {"_id": 0, "slug": 1, "floor_ton": 1}
    ):
        it = await items_col.find_one({"slug": g["slug"]}, {"_id": 0, "name": 1, "rarity": 1})
        pool.append({"slug": g["slug"], "floor": float(g["floor_ton"]),
                     "name": (it or {}).get("name", g["slug"])})
    pool.sort(key=lambda x: x["floor"])
    return pool


def _select(pool: list[dict[str, Any]], price: float) -> list[dict[str, Any]]:
    """Pick a spread across bands; spread items within each band evenly."""
    chosen: list[dict[str, Any]] = []
    used: set[str] = set()
    for rarity, lo, hi, k in BANDS:
        band = [p for p in pool if lo * price <= p["floor"] < hi * price and p["slug"] not in used]
        if not band:
            continue
        # evenly sample up to k items across the band (cheap→dear)
        idxs = {round(i * (len(band) - 1) / max(1, k - 1)) for i in range(min(k, len(band)))}
        for i in sorted(idxs):
            it = {**band[i], "rarity": rarity}
            chosen.append(it)
            used.add(it["slug"])
    # Fallback: if too few items (catalog can't fill bands), add nearest-value gifts.
    if len(chosen) < MIN_ITEMS:
        for p in sorted(pool, key=lambda x: abs(x["floor"] - price)):
            if p["slug"] in used:
                continue
            chosen.append({**p, "rarity": "common"})
            used.add(p["slug"])
            if len(chosen) >= MIN_ITEMS:
                break
    return chosen


def _solve_weights(payouts: list[float], target_ev: float) -> list[float]:
    """weight_i ∝ exp(α·payout); binary-search α so EV == target. Monotonic in α."""
    def ev_at(alpha: float) -> float:
        w = [math.exp(alpha * p) for p in payouts]
        return sum(a * b for a, b in zip(payouts, w)) / sum(w)
    lo, hi = -3.0, 3.0
    for _ in range(90):
        mid = (lo + hi) / 2.0
        if ev_at(mid) < target_ev:
            lo = mid
        else:
            hi = mid
    alpha = (lo + hi) / 2.0
    raw = [math.exp(alpha * p) for p in payouts]
    # Normalise to a fixed large total so weights stay within MongoDB's int64 even
    # for wide value ranges. The total is big enough (1e6) that forcing an
    # ultra-rare jackpot up to weight 1 adds negligible EV (≈ floor/1e6 TON).
    s = sum(raw) or 1.0
    return [max(1, round(1_000_000 * r / s)) for r in raw]


async def main() -> None:
    pool = await _load_pool()
    if len(pool) < MIN_ITEMS:
        print(f"[rebuild] only {len(pool)} priced gifts — aborting")
        return
    cheapest = pool[0]["floor"]

    rebuilt = 0
    async for c in cases_col.find({"price_ton": {"$gt": 0}}, {"_id": 0, "id": 1, "name": 1, "price_ton": 1}):
        price = float(c["price_ton"])
        target_ev = TARGET_RTP * price
        if cheapest > target_ev:
            print(f"[rebuild] {c['id']}: cheapest gift {cheapest} > target EV {target_ev:.1f} — skip")
            continue
        items = _select(pool, price)
        if len(items) < MIN_ITEMS:
            print(f"[rebuild] {c['id']}: only {len(items)} items available — skip")
            continue
        payouts = [it["floor"] for it in items]
        weights = _solve_weights(payouts, target_ev)
        basket = [
            {"slug": it["slug"], "payout_ton": round(it["floor"], 4),
             "weight": w, "rarity": it["rarity"]}
            for it, w in zip(items, weights)
        ]
        tw = sum(w for w in weights)
        ev = sum(it["floor"] * w for it, w in zip(items, weights)) / tw
        await cases_col.update_one(
            {"id": c["id"]},
            {"$set": {"basket": basket, "target_ev_pct": TARGET_RTP * 100}},
        )
        rebuilt += 1
        jackpot = max(items, key=lambda x: x["floor"])
        print(f"[rebuild] {c['name'][:16]:16} price={price:<6.0f} items={len(basket):<2d} "
              f"RTP={ev/price*100:.1f}% jackpot={jackpot['slug']}({jackpot['floor']:.0f}={jackpot['floor']/price:.0f}x)")
    print(f"[rebuild] done — {rebuilt} cases rebuilt")


if __name__ == "__main__":
    asyncio.run(main())
