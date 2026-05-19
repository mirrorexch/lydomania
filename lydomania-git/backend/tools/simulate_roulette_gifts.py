"""
Phase 6e calibration sim — runs N synthetic roulette rounds against the live
roulette baskets in MongoDB and reports realized RTP per basket + overall.

RTP definition (gift mode):
    For each bet of `amount_ton` on `color` that wins:
       won_value_ton = chosen_item.floor_price_ton  (deterministic HMAC pick)
    For losing bets, won_value_ton = 0.
    RTP = Σ won_value_ton / Σ amount_ton

Per the design brief, target overall RTP is in [88%, 96%].

Usage:
    cd /app/backend && python -m tools.simulate_roulette_gifts --rounds 1000
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import secrets
from collections import defaultdict
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

from core.roulette_engine import (
    BET_TIERS, color_for_index, derive_client_seed_combined,
    derive_item_pick, derive_segment_index,
)


async def _load_baskets() -> dict[tuple[float, str], dict[str, Any]]:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    out: dict[tuple[float, str], dict[str, Any]] = {}
    async for b in db["roulette_baskets"].find({}, {"_id": 0}):
        out[(float(b["tier"]), b["color"])] = b
    # also gather item floors
    item_floors: dict[str, float] = {}
    async for it in db["items"].find({}, {"_id": 0, "slug": 1, "floor_price_ton": 1}):
        item_floors[it["slug"]] = float(it.get("floor_price_ton") or 0.0)
    for b in out.values():
        for it in b.get("items", []):
            it["_floor_ton"] = item_floors.get(it["item_slug"], 0.0)
    client.close()
    return out


def simulate(baskets: dict, n_rounds: int, *, seed: int | None) -> dict:
    """Simulate `n_rounds` and report per-basket + overall RTP.

    Fully deterministic when `seed` is provided: bet ids, server seeds,
    and round ids are all derived from the seeded RNG (no os.urandom).
    """
    rng = random.Random(seed)
    def _hex(n_bytes: int) -> str:
        return rng.getrandbits(8 * n_bytes).to_bytes(n_bytes, "big").hex()
    color_choices = ("red", "black", "green")
    color_weights = (0.45, 0.45, 0.10)

    wagered_total = 0.0
    won_total = 0.0
    per_basket_wagered: dict[tuple[float, str], float] = defaultdict(float)
    per_basket_won: dict[tuple[float, str], float] = defaultdict(float)
    color_hits = defaultdict(int)

    for _ in range(n_rounds):
        # 5-20 synthetic bets per round
        n_bets = rng.randint(5, 20)
        bet_ids = [_hex(8) for _ in range(n_bets)]
        server_seed = _hex(32)
        round_id = _hex(8)
        csc = derive_client_seed_combined(bet_ids)
        idx = derive_segment_index(server_seed, csc, round_id)
        winning_color = color_for_index(idx)
        color_hits[winning_color] += 1

        for bid in bet_ids:
            tier = rng.choices(list(BET_TIERS), weights=[0.55, 0.30, 0.15], k=1)[0]
            color = rng.choices(color_choices, weights=color_weights, k=1)[0]
            wagered_total += tier
            per_basket_wagered[(tier, color)] += tier
            if color == winning_color:
                basket = baskets.get((tier, winning_color))
                if not basket:
                    continue
                pick = derive_item_pick(server_seed, round_id, bid, basket["items"])
                # Find the floor for the chosen slug
                floor = next(
                    (float(it.get("_floor_ton") or 0.0)
                     for it in basket["items"] if it["item_slug"] == pick["item_slug"]),
                    0.0,
                )
                won_total += floor
                per_basket_won[(tier, winning_color)] += floor

    overall_rtp = 100.0 * won_total / wagered_total if wagered_total else 0.0
    per_basket: list[dict] = []
    for (tier, color) in sorted(per_basket_wagered.keys()):
        w = per_basket_wagered[(tier, color)]
        p = per_basket_won[(tier, color)]
        per_basket.append({
            "tier": tier, "color": color,
            "wagered_ton": round(w, 4),
            "won_ton": round(p, 4),
            "rtp_pct": round(100.0 * p / w, 3) if w else 0.0,
        })
    return {
        "rounds": n_rounds,
        "wagered_total_ton": round(wagered_total, 4),
        "won_total_ton": round(won_total, 4),
        "overall_rtp_pct": round(overall_rtp, 3),
        "color_hit_rate": {
            c: round(color_hits[c] / n_rounds, 4) for c in ("red", "black", "green")
        },
        "per_basket": per_basket,
    }


async def main_async(n_rounds: int, seed: int | None) -> int:
    baskets = await _load_baskets()
    if len(baskets) < 9:
        print(f"⚠ only {len(baskets)} baskets found — run tools.seed_roulette_baskets first")
        return 2

    r = simulate(baskets, n_rounds, seed=seed)
    print(f"=== Phase 6e — Roulette gift-prize calibration sim ({n_rounds} rounds) ===")
    print(f"  wagered total : {r['wagered_total_ton']:.2f} TON")
    print(f"  won total     : {r['won_total_ton']:.2f} TON")
    print(f"  overall RTP   : {r['overall_rtp_pct']:.3f}%")
    print(f"  color hits    : {r['color_hit_rate']}  (expected 7/15 · 7/15 · 1/15)")
    print()
    print(f"  {'tier':>5} {'color':<6} {'wagered':>12} {'won':>12} {'RTP':>8}")
    print("  " + "-" * 50)
    for row in r["per_basket"]:
        print(f"  {row['tier']:>5.0f} {row['color']:<6} {row['wagered_ton']:>12.2f} "
              f"{row['won_ton']:>12.2f} {row['rtp_pct']:>7.2f}%")
    if 88.0 <= r["overall_rtp_pct"] <= 96.0:
        print("\n✓ overall RTP within [88, 96] acceptance band")
        return 0
    print(f"\n✗ OUTSIDE acceptance band  (got {r['overall_rtp_pct']:.2f}%)")
    return 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rounds", type=int, default=1000)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()
    return asyncio.run(main_async(args.rounds, args.seed))


if __name__ == "__main__":
    raise SystemExit(main())
