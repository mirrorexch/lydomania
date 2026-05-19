"""
Phase 6c calibration sim — runs N synthetic roulette rounds against the pure
segment-derivation function, scoring realized RTP under a synthetic bet mix.

Usage:
    python -m tools.simulate_roulette --rounds 1000
"""

from __future__ import annotations

import argparse
import random
import secrets
from collections import defaultdict

from core.roulette_engine import (
    color_for_index, derive_client_seed_combined,
    derive_segment_index, payout_multiplier,
)


# Realistic bet mix observed on competitor wheels — heavy red/black, light green.
BET_MIX = (
    ("red",   0.45),  # 45% of stake on red
    ("black", 0.45),  # 45% on black
    ("green", 0.10),  # 10% on green
)


def simulate(n_rounds: int = 1000, seed: int | None = None) -> dict:
    rng = random.Random(seed)
    wagered = 0.0
    paid = 0.0
    by_color_wagered: dict[str, float] = defaultdict(float)
    by_color_paid: dict[str, float] = defaultdict(float)
    color_hits = defaultdict(int)

    for _ in range(n_rounds):
        # Random ~5–20 bets per round, amounts ~U(0.1, 50)
        bet_ids = [secrets.token_hex(8) for _ in range(rng.randint(5, 20))]
        server_seed = secrets.token_hex(32)
        round_id = secrets.token_hex(8)
        csc = derive_client_seed_combined(bet_ids)
        idx = derive_segment_index(server_seed, csc, round_id)
        winning_color = color_for_index(idx)
        color_hits[winning_color] += 1
        # Place 1 synthetic bet per slot according to BET_MIX
        for _bid in bet_ids:
            color = rng.choices(
                [c for c, _ in BET_MIX], weights=[w for _, w in BET_MIX], k=1,
            )[0]
            amount = round(rng.uniform(0.5, 5.0), 2)
            wagered += amount
            by_color_wagered[color] += amount
            if color == winning_color:
                p = amount * payout_multiplier(color)
                paid += p
                by_color_paid[color] += p

    return {
        "rounds": n_rounds,
        "wagered_ton": round(wagered, 4),
        "paid_ton": round(paid, 4),
        "realized_rtp_pct": round(100 * paid / wagered, 3) if wagered else 0.0,
        "house_edge_pct": round(100 * (1 - paid / wagered), 3) if wagered else 0.0,
        "color_hit_rate": {
            c: round(color_hits[c] / n_rounds, 4) for c in ("red", "black", "green")
        },
        "by_color_rtp_pct": {
            c: round(
                100 * by_color_paid[c] / max(by_color_wagered[c], 1e-9), 3,
            ) for c in ("red", "black", "green")
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rounds", type=int, default=1000)
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()
    r = simulate(args.rounds, args.seed)
    print("=== Roulette calibration sim ===")
    print(f"  rounds            : {r['rounds']}")
    print(f"  wagered           : {r['wagered_ton']:.2f} TON")
    print(f"  paid              : {r['paid_ton']:.2f} TON")
    print(f"  realized RTP      : {r['realized_rtp_pct']:.3f}%")
    print(f"  house edge        : {r['house_edge_pct']:.3f}%")
    print(f"  color hit rate    : {r['color_hit_rate']}")
    print("  expected hit rate : red 46.67% · black 46.67% · green 6.67%")
    print(f"  by-color RTP      : {r['by_color_rtp_pct']}")
    # Acceptance band: 88–96% over 1000 rounds
    if 88.0 <= r["realized_rtp_pct"] <= 96.0:
        print("✓ within acceptance band (88–96%)")
        return 0
    print(f"✗ OUTSIDE acceptance band  (got {r['realized_rtp_pct']:.2f}%)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
