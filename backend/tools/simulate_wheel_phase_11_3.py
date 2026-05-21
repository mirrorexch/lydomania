#!/usr/bin/env python3
"""Phase 11.3 — Wheel simulation report.

Closed-form EV calculation + 1000-spin Monte Carlo over the new
SEGMENT_DEFS in core/wheel_engine.py. Pulls floor prices from the live
items collection so the report reflects exactly what users will see.

Usage:
    docker compose exec backend python -m tools.simulate_wheel_phase_11_3
    # or in sandbox:
    cd /app/backend && python -m tools.simulate_wheel_phase_11_3
"""

from __future__ import annotations

import asyncio
import os
import secrets
from collections import Counter

from motor.motor_asyncio import AsyncIOMotorClient

from core.wheel_engine import (
    PAID_SPIN_COST_TON, SEGMENT_DEFS, derive_segment, expected_value,
    payout_for_segment, rtp, total_weight,
)


async def fetch_floors() -> dict[str, float]:
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ.get("DB_NAME", "lydomania")]
    slugs = sorted({s["item_slug"] for s in SEGMENT_DEFS if s.get("item_slug")})
    out: dict[str, float] = {}
    async for d in db["items"].find(
        {"slug": {"$in": slugs}},
        {"_id": 0, "slug": 1, "floor_price_ton": 1},
    ):
        out[d["slug"]] = float(d.get("floor_price_ton") or 0.0)
    return out


def print_closed_form_table(floors: dict[str, float]) -> None:
    tw = total_weight(SEGMENT_DEFS)
    print(f"\n=== Closed-form EV / RTP ===")
    print(f"PAID_SPIN_COST_TON = {PAID_SPIN_COST_TON}")
    print(f"total_weight       = {tw}")
    print(f"\n{'idx':>3} {'type':<11} {'item/mult':<20} {'w':>3} {'prob':>7} {'avg':>8} {'EV':>8}")
    print("─" * 70)
    by_tier: dict[str, dict] = {}
    for s in SEGMENT_DEFS:
        p = int(s["weight"]) / tw
        v = payout_for_segment(s, PAID_SPIN_COST_TON, floors)["estimated_value_ton"]
        ev = p * v
        t = s["segment_type"]
        bt = by_tier.setdefault(t, {"w": 0, "ev": 0.0, "mn": float("inf"), "mx": 0.0})
        bt["w"] += int(s["weight"])
        bt["ev"] += ev
        bt["mn"] = min(bt["mn"], v)
        bt["mx"] = max(bt["mx"], v)
        label = s.get("item_slug") or f"×{s.get('multiplier')}"
        print(f"{int(s['segment_index']):>3} {t:<11} {label:<20} {int(s['weight']):>3} {p*100:>6.2f}% {v:>7.2f} {ev:>7.3f}")
    ev_total = expected_value(SEGMENT_DEFS, PAID_SPIN_COST_TON, floors)
    rtp_total = rtp(SEGMENT_DEFS, PAID_SPIN_COST_TON, floors)
    print("─" * 70)
    print(f"\n{'TOTAL EV':<58} {ev_total:>7.3f} T")
    print(f"{'RTP':<58} {rtp_total*100:>6.2f}%")
    print(f"{'House edge':<58} {(1-rtp_total)*100:>6.2f}%")
    print("\n=== Per-tier breakdown ===")
    print(f"{'tier':<11} {'w':>4} {'prob':>7} {'min':>7} {'max':>7} {'avg':>7} {'EV':>7}")
    for t in ["ton_multi", "low_gift", "mid_gift", "high_gift", "jackpot"]:
        if t not in by_tier: continue
        bt = by_tier[t]
        prob = bt["w"]/tw
        avg = bt["ev"]/prob if prob else 0
        print(f"{t:<11} {bt['w']:>4} {prob*100:>6.2f}% {bt['mn']:>6.2f}T {bt['mx']:>6.2f}T {avg:>6.2f}T {bt['ev']:>6.3f}T")
    print("\n=== Hierarchy invariant (avg payout must strictly increase) ===")
    prev = 0
    ok = True
    for t in ["low_gift", "mid_gift", "high_gift", "jackpot"]:
        if t not in by_tier: continue
        bt = by_tier[t]
        prob = bt["w"]/tw
        avg = bt["ev"]/prob if prob else 0
        flag = "OK" if avg > prev else "★★★ BROKEN"
        if avg <= prev: ok = False
        print(f"  {t:<11} avg={avg:>6.2f}T   {flag}")
        prev = avg
    print(f"\nHierarchy: {'PASS ✓' if ok else 'FAIL ✗'}")


def run_simulation(floors: dict[str, float], n: int) -> None:
    print(f"\n=== Monte-Carlo simulation: {n} spins ===")
    tier_counts: Counter[str] = Counter()
    total_payout = 0.0
    big_wins: list[tuple[int, str, float]] = []  # (i, tier, payout)
    for i in range(n):
        ss = secrets.token_hex(32)
        sid = secrets.token_hex(12)
        idx = derive_segment(ss, sid)
        seg = SEGMENT_DEFS[idx]
        v = payout_for_segment(seg, PAID_SPIN_COST_TON, floors)["estimated_value_ton"]
        tier_counts[seg["segment_type"]] += 1
        total_payout += v
        if v >= 25.0:
            big_wins.append((i, seg["segment_type"], v))
    print(f"{'tier':<11} {'count':>6} {'pct':>7}")
    for t in ["ton_multi", "low_gift", "mid_gift", "high_gift", "jackpot"]:
        c = tier_counts.get(t, 0)
        print(f"{t:<11} {c:>6} {c/n*100:>6.2f}%")
    print(f"\nTotal payout (n={n})        = {total_payout:.2f} T")
    print(f"Total spent  (n={n} × 5 T) = {n*PAID_SPIN_COST_TON:.2f} T")
    print(f"Empirical RTP              = {total_payout/(n*PAID_SPIN_COST_TON)*100:.2f}%")
    if big_wins:
        print(f"\nBig wins (≥25 T): {len(big_wins)}")
        for i, t, v in big_wins[:5]:
            print(f"  spin #{i+1:>4} · {t:<10} · {v:.2f} T")


async def main() -> None:
    floors = await fetch_floors()
    print("Floor prices fetched from items collection:")
    for slug, floor in sorted(floors.items()):
        print(f"  {slug:18s} = {floor:>6.2f} T")
    print_closed_form_table(floors)
    run_simulation(floors, n=1000)


if __name__ == "__main__":
    asyncio.run(main())
