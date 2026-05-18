"""
Phase 6e — Seed/calibrate the 9 Roulette gift baskets.

The current Roulette engine maps (bet_tier × winning_color) → one of 9 baskets.
Each basket is a list of (item_slug, weight). The weighted-mean of the chosen
item's `floor_price_ton` must approximate `target_floor_ton` so that overall RTP
sits in [88%, 96%].

Target expected basket floors (TON):
    1 TON   RED   ~ 1.99      5 TON   RED   ~ 9.96     25 TON   RED   ~ 49.8
    1 TON   BLACK ~ 1.99      5 TON   BLACK ~ 9.96     25 TON   BLACK ~ 49.8
    1 TON   GREEN ~ 13.94     5 TON   GREEN ~ 69.7     25 TON   GREEN ~ 348.5

Algorithm:
    1. For each basket: select a candidate-item pool by value band.
    2. Initialise uniform weights = 10.
    3. Iteratively adjust weights to push expected-floor toward the target,
       capped so no item exceeds 5× / drops below 1/5× the base weight.
    4. Persist as `roulette_baskets` rows.

Idempotent. Re-run after a Fragment floor refresh to recalibrate.

Usage:
    cd /app/backend && python -m tools.seed_roulette_baskets
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient


# (tier_ton, color) → (target_expected_floor_ton, candidate-band [floor_min, floor_max], desired_size)
BASKETS: list[dict[str, Any]] = [
    {"tier": 1.0,  "color": "red",   "target": 1.99,   "band": (0.5,   5.0),   "size": (8, 10)},
    {"tier": 1.0,  "color": "black", "target": 1.99,   "band": (0.5,   5.0),   "size": (8, 10)},
    {"tier": 1.0,  "color": "green", "target": 13.94,  "band": (5.0,   60.0),  "size": (10, 12)},
    {"tier": 5.0,  "color": "red",   "target": 9.96,   "band": (3.0,   25.0),  "size": (8, 10)},
    {"tier": 5.0,  "color": "black", "target": 9.96,   "band": (3.0,   25.0),  "size": (8, 10)},
    {"tier": 5.0,  "color": "green", "target": 69.7,   "band": (25.0,  250.0), "size": (8, 12)},
    {"tier": 25.0, "color": "red",   "target": 49.8,   "band": (10.0,  120.0), "size": (8, 12)},
    {"tier": 25.0, "color": "black", "target": 49.8,   "band": (10.0,  120.0), "size": (8, 12)},
    {"tier": 25.0, "color": "green", "target": 348.5,  "band": (100.0, 8000.0),"size": (8, 12)},
]


def _ev(items: list[dict]) -> float:
    tot_w = sum(float(b["weight"]) for b in items)
    if tot_w <= 0:
        return 0.0
    return sum(float(b["weight"]) * float(b["floor"]) for b in items) / tot_w


def _calibrate_weights(items: list[dict], target: float, max_iter: int = 600) -> list[dict]:
    """Adjust weights to make weighted mean of `floor` → target. Caps weight ∈ [1, 250]."""
    items = [{"item_slug": b["item_slug"], "floor": float(b["floor"]), "weight": 10.0} for b in items]
    if len(items) < 2:
        return items
    for _ in range(max_iter):
        cur = _ev(items)
        if abs(cur - target) / target < 0.005:
            break
        going_low = cur < target
        for b in items:
            f = float(b["floor"])
            if going_low:
                factor = 1.025 if f > cur else 0.985
            else:
                factor = 0.985 if f > cur else 1.025
            b["weight"] = max(1.0, min(250.0, b["weight"] * factor))
    # Round to 1 dp
    for b in items:
        b["weight"] = round(b["weight"], 1)
    return items


def _select_pool(all_items: list[dict], band: tuple[float, float], size_range: tuple[int, int],
                 target: float) -> list[dict]:
    """Pick a candidate pool: items whose floor is in `band`, sorted so the value spread is wide."""
    lo, hi = band
    in_band = [
        {"item_slug": i["slug"], "floor": float(i.get("floor_price_ton") or 0.0)}
        for i in all_items
        if lo <= float(i.get("floor_price_ton") or 0.0) <= hi
    ]
    # Dedup by slug
    seen: set[str] = set()
    uniq: list[dict] = []
    for it in in_band:
        if it["item_slug"] in seen:
            continue
        seen.add(it["item_slug"])
        uniq.append(it)

    # Want a mix of values around target. Sort by |floor - target|, take first `size`
    # but only after biasing slightly toward the spread (lowest, highest, then middle).
    uniq.sort(key=lambda x: abs(x["floor"] - target))
    desired_min, desired_max = size_range
    take = min(desired_max, max(desired_min, len(uniq)))
    pool = uniq[:take]
    # Ensure at least one item below and one above target if available
    below = [x for x in uniq if x["floor"] < target]
    above = [x for x in uniq if x["floor"] >= target]
    if below and not any(x["floor"] < target for x in pool):
        pool[-1] = below[0]
    if above and not any(x["floor"] >= target for x in pool):
        pool[0] = above[0]
    return pool


async def main() -> int:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    baskets_col = db["roulette_baskets"]

    items = await db.items.find(
        {}, {"_id": 0, "slug": 1, "floor_price_ton": 1}
    ).to_list(None)
    print(f"[seed_roulette_baskets] {len(items)} items in catalog")

    print(f"\n{'(tier,color)':<14} {'target':>8} {'achieved':>10} {'drift':>8} {'size':>5}  items")
    print("-" * 100)
    total_inserted = 0
    for cfg in BASKETS:
        pool = _select_pool(items, cfg["band"], cfg["size"], cfg["target"])
        if len(pool) < 2:
            print(f"  SKIP ({cfg['tier']:.0f},{cfg['color']}) — only {len(pool)} candidate items in band {cfg['band']}")
            continue
        calibrated = _calibrate_weights(pool, cfg["target"])
        achieved = _ev(calibrated)
        drift = (achieved - cfg["target"]) / cfg["target"] * 100
        slugs = [f"{b['item_slug']}({float(b['weight']):.0f})" for b in calibrated[:5]]
        line = f"  ({int(cfg['tier'])}, {cfg['color']:<5}) {cfg['target']:>8.2f} {achieved:>10.2f} {drift:>+6.1f}% {len(calibrated):>5}  " + ", ".join(slugs)
        if len(calibrated) > 5:
            line += f", … (+{len(calibrated)-5})"
        print(line)

        doc = {
            "id": f"{int(cfg['tier'])}_{cfg['color']}",
            "tier": float(cfg["tier"]),
            "color": cfg["color"],
            "items": [
                {"item_slug": b["item_slug"], "weight": float(b["weight"])}
                for b in calibrated
            ],
            "target_floor_ton": float(cfg["target"]),
            "expected_floor_ton": round(achieved, 4),
            "updated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        await baskets_col.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
        total_inserted += 1

    print(f"\nDone. {total_inserted} baskets upserted into `roulette_baskets`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
