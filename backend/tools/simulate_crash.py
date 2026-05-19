"""Phase 7a — Crash calibration sim.

Usage:
    cd /app/backend && python -m tools.simulate_crash [N_ROUNDS]

Defaults to 10 000 rounds. Prints:
  • realised RTP assuming a baseline auto-cashout strategy (cash out at 2.0×)
  • median / mean / p90 / p99 crash multiplier
  • distribution histogram (bucketed log-uniform)
  • house-edge sink rate

The target spec is RTP ∈ [97, 99] %. The bustabit formula with HOUSE_DIVISOR=33
delivers RTP ~ 1 − 1/33 ≈ 96.97 % for any pure cashout-at-X strategy when
X > 1.00 — empirically confirmed below.
"""

from __future__ import annotations

import math
import secrets
import sys
from collections import Counter
from statistics import mean, median

from core.crash_engine import HOUSE_DIVISOR, derive_crash_multiplier


def quantile(values: list[float], q: float) -> float:
    s = sorted(values)
    if not s:
        return 0.0
    k = (len(s) - 1) * q
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] + (s[c] - s[f]) * (k - f)


def simulate(n: int, server_seed_pool: list[str] | None = None) -> dict:
    crashes: list[float] = []
    instant = 0
    for i in range(n):
        ss = (server_seed_pool[i % len(server_seed_pool)]
              if server_seed_pool else secrets.token_hex(32))
        round_id = secrets.token_hex(8)
        cx = derive_crash_multiplier(ss, round_id, "")
        crashes.append(cx)
        if cx == 1.00:
            instant += 1

    # Auto-cashout-at-X strategy realised RTP:
    rtp_per_x: dict[float, float] = {}
    for x in (1.5, 2.0, 5.0, 10.0):
        wagered = float(n)
        paid = sum(x if c > x else 0.0 for c in crashes)
        rtp_per_x[x] = paid / wagered

    # Histogram in log-uniform buckets
    buckets = [(1.0, 1.0), (1.001, 1.50), (1.50, 2.00), (2.00, 5.00),
               (5.00, 10.00), (10.00, 25.00), (25.00, 100.0),
               (100.0, 1_000.0), (1_000.0, math.inf)]
    hist = Counter()
    for c in crashes:
        for lo, hi in buckets:
            if lo <= c < hi or (lo == 1.0 and c == 1.00):
                hist[(lo, hi)] += 1
                break

    return {
        "n": n,
        "instant_crashes": instant,
        "instant_pct": 100.0 * instant / n,
        "mean": mean(crashes),
        "median": median(crashes),
        "p90": quantile(crashes, 0.90),
        "p99": quantile(crashes, 0.99),
        "max": max(crashes),
        "rtp_strategy_x": rtp_per_x,
        "hist": hist,
    }


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    print(f"Simulating {n} crash rounds (HOUSE_DIVISOR={HOUSE_DIVISOR}) …")
    res = simulate(n)
    print(f"  instant crashes (1.00×):  {res['instant_crashes']:>6d}  ({res['instant_pct']:.2f} %)")
    print(f"  mean crash multiplier:    {res['mean']:.4f}")
    print(f"  median:                   {res['median']:.4f}")
    print(f"  p90:                      {res['p90']:.4f}")
    print(f"  p99:                      {res['p99']:.4f}")
    print(f"  max:                      {res['max']:.4f}")
    print("  realised RTP by cashout-at-X strategy:")
    for x, r in res["rtp_strategy_x"].items():
        flag = " ✓" if 0.97 <= r <= 0.99 else (" !" if r < 0.95 or r > 0.995 else "")
        print(f"      x = {x:>5.2f}  →  RTP = {r*100:>6.3f} %{flag}")
    print("  histogram (crash multiplier bucket → count):")
    for (lo, hi), c in sorted(res["hist"].items(), key=lambda kv: kv[0][0]):
        hi_s = "∞" if hi == math.inf else f"{hi:.3f}"
        print(f"      [{lo:>7.3f} , {hi_s:>7s})  →  {c:>6d}  {'#'*int(60 * c / n)}")


if __name__ == "__main__":
    main()
