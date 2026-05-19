"""Phase 7b — Wheel calibration sim.

Usage:
    cd /app/backend && python -m tools.simulate_wheel [N_SPINS]

Defaults to 5 000 spins. Prints realised RTP given the SEGMENT_DEFS table
and the current item floor prices read from the `items` collection.

Target: 88-96 % across all paid spins. Sample-variance band on n=5000 is
roughly ±1.5 % so the closed-form EV had better land near the middle of the
target band.
"""

from __future__ import annotations

import asyncio
import secrets
import sys
from collections import Counter

from core.db import items_col
from core.wheel_engine import (
    PAID_SPIN_COST_TON, SEGMENT_DEFS, derive_segment,
    expected_value, payout_for_segment, rtp,
)


async def _floors() -> dict[str, float]:
    slugs = [s["item_slug"] for s in SEGMENT_DEFS if s.get("item_slug")]
    cur = items_col.find({"slug": {"$in": slugs}},
                         {"_id": 0, "slug": 1, "floor_price_ton": 1})
    return {d["slug"]: float(d.get("floor_price_ton") or 0.0) async for d in cur}


async def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5_000
    floors = await _floors()
    closed = rtp(SEGMENT_DEFS, PAID_SPIN_COST_TON, floors)
    print(f"Closed-form RTP from SEGMENT_DEFS + live floors: {closed*100:.3f} %")
    print(f"Simulating {n} spins …")
    counter = Counter()
    total_value = 0.0
    for _ in range(n):
        ss = secrets.token_hex(32)
        spin_id = secrets.token_hex(12)
        idx = derive_segment(ss, spin_id, SEGMENT_DEFS)
        seg = SEGMENT_DEFS[idx]
        p = payout_for_segment(seg, PAID_SPIN_COST_TON, floors)
        counter[seg["segment_type"]] += 1
        total_value += p["estimated_value_ton"]
    sim_rtp = total_value / (n * PAID_SPIN_COST_TON)
    in_band = " ✓" if 0.88 <= sim_rtp <= 0.96 else " ⚠"
    print(f"Simulated RTP:  {sim_rtp*100:.3f} %{in_band}    (target 88-96 %)")
    print("Segment-type frequencies:")
    for k in ("ton_multi", "low_gift", "mid_gift", "high_gift", "jackpot"):
        c = counter[k]
        print(f"  {k:>10}  {c:>6}  ({100*c/n:.2f} %)")
    print("Item floor lookup:")
    for slug, f in sorted(floors.items(), key=lambda kv: kv[1]):
        print(f"  {slug:<25}  floor = {f:>7.2f} TON")


if __name__ == "__main__":
    asyncio.run(main())
