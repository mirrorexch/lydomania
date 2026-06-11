"""One-off migration: reprice Pocket Box to 5 TON and rebuild its basket from
LIVE gift floors so RTP = 90% (EV 4.5 on a 5-TON ticket).

Why a custom rebuild instead of recalibrate_case(): the cheapest real Telegram
gift floors at ~3 TON, and the generic case calibrator (which only solves a
single jackpot-item weight) can't pull this basket's EV onto target. Here we
pick a spread of real cheap/mid gifts and solve item weights directly
(weight ∝ exp(α·floor), binary-search α) to land EV exactly on 0.90 × price.

Idempotent: re-running rebuilds the basket from current live floors.

Usage:  cd /app/backend && python -m tools.migrate_pocket_box_5ton
"""
from __future__ import annotations

import asyncio
import math

from core.db import cases_col, gift_floor_prices_col, items_col

PRICE = 5.0
TARGET_RTP = 0.90
# Real gifts to compose the basket from (cheap → mid). Floors come from live data;
# any without a live floor are skipped. A spread keeps the case visually varied.
CANDIDATE_SLUGS = [
    "lol_pop", "candy_cane", "lunar_snake", "snake_box", "tama_gadget",
    "homemade_cake", "snow_mittens", "ginger_cookie", "santa_hat", "winter_wreath",
    "easter_egg", "party_sparkler", "spy_agaric", "trapped_heart", "magic_potion",
    "perfume_bottle", "westside_sign",
]


async def _live_floor(slug: str) -> float:
    d = await gift_floor_prices_col.find_one(
        {"slug": slug, "source": "fragment", "floor_ton": {"$gt": 0}}, {"_id": 0, "floor_ton": 1}
    )
    if d and d.get("floor_ton"):
        return float(d["floor_ton"])
    it = await items_col.find_one({"slug": slug}, {"_id": 0, "floor_price_ton": 1})
    return float(it.get("floor_price_ton") or 0) if it else 0.0


def _ev(payouts: list[float], weights: list[float]) -> float:
    tw = sum(weights)
    return sum(p * w for p, w in zip(payouts, weights)) / tw if tw else 0.0


def _solve_weights(payouts: list[float], target_ev: float) -> list[float]:
    """weight_i ∝ exp(α·payout_i); binary-search α so EV == target. Monotonic in α."""
    def ev_at(alpha: float) -> float:
        w = [math.exp(alpha * p) for p in payouts]
        return _ev(payouts, w)
    lo, hi = -2.0, 2.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if ev_at(mid) < target_ev:
            lo = mid
        else:
            hi = mid
    alpha = (lo + hi) / 2.0
    raw = [math.exp(alpha * p) for p in payouts]
    s = sum(raw)
    # scale to integer-ish weights summing ~1000, min 1
    return [max(1.0, round(1000 * r / s, 2)) for r in raw]


async def main() -> None:
    case = await cases_col.find_one({"id": "pocket_box"}, {"_id": 0, "id": 1})
    if not case:
        print("[migrate] pocket_box not found — nothing to do")
        return

    pairs = []
    for slug in CANDIDATE_SLUGS:
        f = await _live_floor(slug)
        if f > 0:
            pairs.append((slug, f))
    if len(pairs) < 4:
        print(f"[migrate] only {len(pairs)} priced gifts available — aborting (need ≥4)")
        return

    target_ev = TARGET_RTP * PRICE
    payouts = [f for _, f in pairs]
    if min(payouts) > target_ev:
        print(f"[migrate] cheapest gift {min(payouts)} > target EV {target_ev} — infeasible")
        return

    weights = _solve_weights(payouts, target_ev)
    basket = [
        {"slug": slug, "payout_ton": round(f, 4), "weight": w}
        for (slug, f), w in zip(pairs, weights)
    ]
    realized_ev = _ev(payouts, weights)
    await cases_col.update_one(
        {"id": "pocket_box"},
        {"$set": {"price_ton": PRICE, "target_ev_pct": TARGET_RTP * 100, "basket": basket}},
    )
    print(f"[migrate] pocket_box -> price {PRICE} TON, {len(basket)} gifts, "
          f"EV {realized_ev:.3f} (RTP {realized_ev / PRICE * 100:.1f}%)")


if __name__ == "__main__":
    asyncio.run(main())
