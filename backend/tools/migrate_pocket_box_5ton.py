"""One-off migration: reprice Pocket Box 3 → 5 TON and recalibrate to 90% RTP.

The cheapest real Telegram gift floors at 3 TON, so a 3-TON case can never go
below 100% RTP (the prize is worth at least the ticket). Repricing to 5 TON lets
a basket of 3-4 TON gifts hit the 90% target. Idempotent: re-running just
re-asserts price 5.0 and re-solves the basket.

Usage:  cd /app/backend && python -m tools.migrate_pocket_box_5ton
"""
from __future__ import annotations

import asyncio

from core.db import cases_col
from services.recalibration import recalibrate_case


async def main() -> None:
    case = await cases_col.find_one({"id": "pocket_box"}, {"_id": 0, "id": 1, "price_ton": 1})
    if not case:
        print("[migrate] pocket_box not found — nothing to do")
        return
    old_price = float(case.get("price_ton") or 0)
    await cases_col.update_one(
        {"id": "pocket_box"},
        {"$set": {"price_ton": 5.0, "target_ev_pct": 90.0}},
    )
    print(f"[migrate] pocket_box price {old_price} -> 5.0 TON")
    res = await recalibrate_case("pocket_box", target_ev_pct=90.0, apply=True)
    if res.get("ok"):
        print(f"[migrate] recalibrated OK — realized EV%: {res.get('realized_ev_pct')}")
    else:
        print(f"[migrate] recalibration FAILED: {res.get('error')}")


if __name__ == "__main__":
    asyncio.run(main())
