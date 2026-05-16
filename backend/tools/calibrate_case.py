"""
Calibrate Lydomania cases: reads seed_data/cases.json + seed_data/items.json,
auto-solves each case's jackpot weight to hit exactly target_ev_pct, and prints
the resulting EV for each case.

Usage:  python -m tools.calibrate_case          # report only
        python -m tools.calibrate_case --write  # write back the solved weights
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "seed_data"

sys.path.insert(0, str(ROOT))
from game import compute_basket_ev, solve_jackpot_weight  # noqa: E402


def load_cases() -> dict:
    return json.loads((SEED_DIR / "cases.json").read_text())


def calibrate(write: bool = False) -> int:
    data = load_cases()
    rc = 0
    print(f"{'case':<16} {'price':>7} {'basket EV':>10} {'jackpot w':>10} {'final EV':>10} {'EV %':>7} {'status':>10}")
    print("-" * 78)
    for case in data["cases"]:
        price = float(case["price_ton"])
        target_pct = float(case.get("target_ev_pct", 85.0))
        target_ev_ton = price * target_pct / 100.0
        basket = list(case["basket"])
        basket_ev = compute_basket_ev(basket)
        jackpot = case["jackpot"]
        w_j = solve_jackpot_weight(basket, float(jackpot["payout_ton"]), target_ev_ton)
        if w_j is None:
            print(f"{case['id']:<16} {price:>7.1f} {basket_ev:>10.3f} {'INFEASIBLE':>10}")
            rc = 2
            continue
        # final EV with jackpot folded in
        full = basket + [{"slug": jackpot["slug"], "weight": w_j, "payout_ton": jackpot["payout_ton"]}]
        ev = compute_basket_ev(full)
        pct = ev / price * 100
        ok = abs(pct - target_pct) < 0.001
        status = "OK" if ok else "FAIL"
        print(f"{case['id']:<16} {price:>7.1f} {basket_ev:>10.3f} {w_j:>10.4f} {ev:>10.3f} {pct:>6.2f}% {status:>10}")
        if write:
            jackpot["weight"] = round(w_j, 6)

    if write:
        (SEED_DIR / "cases.json").write_text(json.dumps(data, indent=2))
        print("\nWrote solved jackpot weights back to seed_data/cases.json")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    return calibrate(write=args.write)


if __name__ == "__main__":
    sys.exit(main())
