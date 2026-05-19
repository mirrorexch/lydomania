"""
Phase 3c — Solvency simulator.

Run 100,000 (or N) virtual opens across every enabled case, sample
winning items by the basket weights, and validate that the case
delivers within ±0.5% of its target RTP at scale.

Use this AFTER `sync-all` to confirm the recalibration produces a
casino-favourable economy.

Usage:
    cd /app/backend && python -m tools.verify_solvency [iterations_per_case]
"""
from __future__ import annotations

import asyncio
import os
import random
import sys
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def simulate_case(db, case_id: str, iters: int) -> dict[str, Any]:
    case = await db.cases.find_one({"id": case_id, "enabled": True}, {"_id": 0})
    if not case:
        return {"case_id": case_id, "ok": False, "error": "case not found or disabled"}
    basket = case.get("basket", [])
    if not basket:
        return {"case_id": case_id, "ok": False, "error": "empty basket"}
    price = float(case["price_ton"])
    target = float(case.get("target_ev_pct", 90.0))
    weights = [float(b["weight"]) for b in basket]
    payouts = [float(b["payout_ton"]) for b in basket]
    slugs = [b["slug"] for b in basket]
    total_w = sum(weights)
    # Theoretical EV from the basket weights (the calibrated value)
    theoretical_ev = sum(w * p for w, p in zip(weights, payouts)) / total_w if total_w else 0.0
    theoretical_pct = (theoretical_ev / price * 100.0) if price else 0.0
    # Jackpot prob (most-expensive item) — informs how noisy realized RTP will be
    jp_idx = max(range(len(payouts)), key=lambda i: payouts[i])
    jp_prob = weights[jp_idx] / total_w if total_w else 0.0

    won_total = 0.0
    win_counts = {s: 0 for s in slugs}
    win_payouts = {s: 0.0 for s in slugs}
    for _ in range(iters):
        choice = random.choices(range(len(slugs)), weights=weights, k=1)[0]
        won_total += payouts[choice]
        win_counts[slugs[choice]] += 1
        win_payouts[slugs[choice]] += payouts[choice]

    paid = price * iters
    realized_pct = (won_total / paid * 100.0) if paid else 0.0
    drift = realized_pct - target
    house_pnl = paid - won_total
    house_pnl_pct = (house_pnl / paid * 100.0) if paid else 0.0
    # SOLVENCY check: house P&L must be positive (the most important guarantee)
    solvent = house_pnl > 0
    # THEORETICAL check: math says EV ≈ target (±0.1% rounding)
    ev_math_ok = abs(theoretical_pct - target) <= 0.5

    breakdown = sorted(
        [
            {
                "slug": s, "wins": win_counts[s], "win_pct": round(win_counts[s] / iters * 100.0, 3),
                "payout_ton": payouts[i],
                "contribution_ton": round(win_payouts[s], 4),
                "contribution_pct": round(win_payouts[s] / paid * 100.0, 3) if paid else 0.0,
            }
            for i, s in enumerate(slugs)
        ],
        key=lambda r: -r["wins"],
    )

    return {
        "case_id": case_id, "name": case.get("name"), "price_ton": price,
        "target_ev_pct": target, "iterations": iters,
        "paid_in_ton": round(paid, 4),
        "paid_out_ton": round(won_total, 4),
        "theoretical_ev_pct": round(theoretical_pct, 4),
        "realized_rtp_pct": round(realized_pct, 3),
        "drift_pct": round(drift, 3),
        "jackpot_prob_pct": round(jp_prob * 100.0, 4),
        "solvent": solvent,
        "ev_math_ok": ev_math_ok,
        "house_pnl_ton": round(house_pnl, 4),
        "house_pnl_pct": round(house_pnl_pct, 3),
        "breakdown": breakdown,
    }


async def main() -> None:
    iters = 100_000
    if len(sys.argv) > 1:
        iters = int(sys.argv[1])
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    print(f"\n=== Lydomania solvency simulation · {iters:,} opens per case ===\n")
    print(f"  legend:  EV-math = theoretical EV from basket weights (should match target ±0.5%)")
    print(f"           realized RTP = stochastic outcome of {iters:,} sampled opens (varies with jackpot rarity)")
    print(f"           SOLVENT = house P&L positive (the actual money-safety guarantee)\n")
    reports = []
    async for c in db.cases.find({"enabled": True}, {"_id": 0, "id": 1}).sort("price_ton", 1):
        r = await simulate_case(db, c["id"], iters)
        reports.append(r)
        if not r.get("ok", True):
            print(f"  [{r['case_id']}]  FAILED: {r.get('error')}")
            continue
        flag_solv = "✅" if r["solvent"] else "❌"
        flag_ev = "✓" if r["ev_math_ok"] else "✗"
        print(
            f"  {flag_solv} {r['case_id']:18s}  price={r['price_ton']:>7.1f} target={r['target_ev_pct']:5.2f}%  "
            f"EV-math={r['theoretical_ev_pct']:6.3f}% {flag_ev}  realised={r['realized_rtp_pct']:6.3f}%  "
            f"jp-prob={r['jackpot_prob_pct']:6.3f}%  pnl={r['house_pnl_ton']:+,.0f} TON ({r['house_pnl_pct']:+.2f}%)"
        )
    print("\n=== TOP CONTRIBUTORS PER CASE ===")
    for r in reports:
        if not r.get("breakdown"):
            continue
        print(f"\n  [{r['case_id']}]  target={r['target_ev_pct']}%  EV-math={r['theoretical_ev_pct']:.4f}%  realised={r.get('realized_rtp_pct'):.3f}%")
        for row in r["breakdown"][:5]:
            print(f"    {row['slug']:22s}  wins={row['win_pct']:6.3f}%  payout={row['payout_ton']:>9.2f}  contrib={row['contribution_pct']:6.3f}%")
    print()
    grand_paid = sum(r.get("paid_in_ton", 0) for r in reports if r.get("ok", True))
    grand_paid_out = sum(r.get("paid_out_ton", 0) for r in reports if r.get("ok", True))
    grand_pnl = grand_paid - grand_paid_out
    all_solvent = all(r.get("solvent", False) for r in reports if r.get("ok", True))
    all_ev_ok = all(r.get("ev_math_ok", False) for r in reports if r.get("ok", True))
    print(f"=== GRAND TOTAL · paid={grand_paid:,.0f}  paid_out={grand_paid_out:,.0f}  "
          f"house_pnl={grand_pnl:+,.0f} TON ({grand_pnl/grand_paid*100 if grand_paid else 0:+.3f}%)")
    print(f"    SOLVENCY: {'ALL CASES SOLVENT ✅' if all_solvent else 'SOME CASES UNDERWATER ❌'}")
    print(f"    EV-MATH:  {'ALL WITHIN ±0.5% ✅' if all_ev_ok else 'SOME OFF TARGET ❌'}\n")


if __name__ == "__main__":
    asyncio.run(main())
