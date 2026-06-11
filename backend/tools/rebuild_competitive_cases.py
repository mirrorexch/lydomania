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
WEIGHT_TOTAL = 1_000_000
# (rarity, lo×P, hi×P, max items to take from this band). Multiples are kept
# modest so the reserved upper-tier probabilities below actually fit the 90% RTP
# budget (a 100×+ jackpot would force everything else to ~0%).
BANDS = [
    ("common", 0.4, 1.5, 5),
    ("uncommon", 1.5, 3.0, 4),
    ("rare", 3.0, 6.0, 3),
    ("epic", 6.0, 20.0, 3),
    ("legendary", 20.0, 80.0, 2),
]
# Reserved (fixed) drop probabilities for the upper tiers so they are GENUINELY
# winnable — the "two-tier" model: a rare real jackpot plus hittable mids. The
# common+uncommon bulk is then weighted to hit exactly 90% RTP.
RESERVED = {"rare": 0.04, "epic": 0.012, "legendary": 0.002}
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


def _stable_weights(payouts: list[float], alpha: float) -> list[float]:
    """exp(α·payout), log-sum-exp stabilised (subtract max exponent) so large
    payouts like a 7000-TON jackpot don't overflow math.exp. Subtracting a
    constant from every exponent cancels in the normalisation."""
    exps = [alpha * p for p in payouts]
    m = max(exps)
    return [math.exp(e - m) for e in exps]


def _solve_alpha(floors: list[float], target_avg: float) -> float:
    """Binary-search α so the exp(α·floor)-weighted mean of `floors` == target_avg."""
    def ev_at(alpha: float) -> float:
        w = _stable_weights(floors, alpha)
        return sum(a * b for a, b in zip(floors, w)) / sum(w)
    lo, hi = -3.0, 3.0
    for _ in range(90):
        mid = (lo + hi) / 2.0
        if ev_at(mid) < target_avg:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _assign_two_tier_weights(items: list[dict[str, Any]], price: float) -> list[int]:
    """Two-tier weights: rare/epic/legendary get fixed (winnable) probabilities;
    the common+uncommon bulk is exp(α)-weighted so total EV == 0.90 × price.
    Returns integer weights summing ~WEIGHT_TOTAL."""
    by_tier: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_tier.setdefault(it["rarity"], []).append(it)
    target_ev = TARGET_RTP * price
    res = {t: RESERVED[t] for t in RESERVED if by_tier.get(t)}

    def tier_mean(t: str) -> float:
        xs = by_tier[t]
        return sum(x["floor"] for x in xs) / len(xs)

    reserved_ev = sum(res[t] * tier_mean(t) for t in res)
    rprob = 1.0 - sum(res.values())
    bulk = [it for it in items if it["rarity"] not in res]
    bulk_floors = [it["floor"] for it in bulk]

    if not bulk or rprob <= 0.02:
        # Degenerate (no bulk / everything reserved) — fall back to a plain
        # whole-basket exp solve so we still hit RTP.
        floors = [it["floor"] for it in items]
        a = _solve_alpha(floors, target_ev)
        w = _stable_weights(floors, a)
        s = sum(w) or 1.0
        return [max(1, round(WEIGHT_TOTAL * x / s)) for x in w]

    # The bulk must average this so the whole basket lands on target.
    rem_avg = (target_ev - reserved_ev) / rprob
    rem_avg = min(max(rem_avg, min(bulk_floors)), max(bulk_floors))  # clamp feasible
    a = _solve_alpha(bulk_floors, rem_avg)
    bw = _stable_weights(bulk_floors, a)
    bs = sum(bw) or 1.0
    bulk_prob = {id(it): rprob * (w / bs) for it, w in zip(bulk, bw)}

    out: list[int] = []
    for it in items:
        t = it["rarity"]
        p = (res[t] / len(by_tier[t])) if t in res else bulk_prob[id(it)]
        out.append(max(1, round(WEIGHT_TOTAL * p)))
    return out


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
        weights = _assign_two_tier_weights(items, price)
        basket = [
            {"slug": it["slug"], "payout_ton": round(it["floor"], 4),
             "weight": w, "rarity": it["rarity"]}
            for it, w in zip(items, weights)
        ]
        tw = sum(weights)
        ev = sum(it["floor"] * w for it, w in zip(items, weights)) / tw
        # tier hit-rates for the log
        rates: dict[str, float] = {}
        for it, w in zip(items, weights):
            rates[it["rarity"]] = rates.get(it["rarity"], 0.0) + w / tw
        await cases_col.update_one(
            {"id": c["id"]},
            {"$set": {"basket": basket, "target_ev_pct": TARGET_RTP * 100}},
        )
        rebuilt += 1
        jackpot = max(items, key=lambda x: x["floor"])
        tiers = " ".join(f"{t[:4]}={rates.get(t, 0) * 100:.1f}%"
                         for t in ("rare", "epic", "legendary") if t in rates)
        print(f"[rebuild] {c['name'][:15]:15} P={price:<5.0f} n={len(basket):<2d} "
              f"RTP={ev/price*100:.1f}% jack={jackpot['floor']/price:.0f}x  {tiers}")
    print(f"[rebuild] done — {rebuilt} cases rebuilt")


if __name__ == "__main__":
    asyncio.run(main())
