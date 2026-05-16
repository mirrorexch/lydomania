"""
Seed Lydomania DB with items + cases.

- Reads /app/backend/seed_data/items.json and cases.json
- Solves each case's jackpot weight to hit target_ev_pct exactly
- Upserts into Mongo collections 'items' and 'cases'
- Prints final EV calibration table

Idempotent: re-running updates docs in place.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT))

from game import compute_basket_ev, solve_jackpot_weight  # noqa: E402

SEED_DIR = ROOT / "seed_data"
RARITY_TO_CRATE = {
    "common": "items/crate_common.png",
    "rare": "items/crate_rare.png",
    "epic": "items/crate_epic.png",
    "legendary": "items/crate_legendary.png",
    "mythic": "items/crate_mythic.png",
    "jackpot": "items/crate_jackpot.png",
}


async def main() -> None:
    items_data = json.loads((SEED_DIR / "items.json").read_text())["items"]
    cases_data = json.loads((SEED_DIR / "cases.json").read_text())["cases"]

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # ---- ITEMS ----
    items_col = db["items"]
    await items_col.create_index("slug", unique=True)
    items_by_slug = {}
    print(f"Seeding {len(items_data)} items …")
    for it in items_data:
        doc = {
            "slug": it["slug"],
            "name": it["name"],
            "rarity": it["rarity"],
            "floor_price_ton": float(it["floor_price_ton"]),
            # Prefer per-item authentic image_path from items.json (set by
            # tools/fetch_gift_images.py). Fall back to the rarity crate
            # if a fresh items.json without image_path is loaded.
            "image_path": it.get("image_path") or RARITY_TO_CRATE[it["rarity"]],
        }
        await items_col.update_one({"slug": doc["slug"]}, {"$set": doc}, upsert=True)
        items_by_slug[doc["slug"]] = doc

    # ---- CASES ----
    cases_col = db["cases"]
    await cases_col.create_index("id", unique=True)
    print(f"\nSeeding {len(cases_data)} cases …")
    print(f"{'case':<16} {'price':>7} {'basket EV':>10} {'jp w':>9} {'EV TON':>9} {'EV %':>7} {'status':>9}")
    print("-" * 76)

    all_ok = True
    for case in cases_data:
        price = float(case["price_ton"])
        target_pct = float(case.get("target_ev_pct", 85.0))
        target_ev_ton = price * target_pct / 100.0
        basket = [dict(b) for b in case["basket"]]  # mutable copies
        basket_ev = compute_basket_ev(basket)
        jp_payout = float(case["jackpot"]["payout_ton"])
        w_j = solve_jackpot_weight(basket, jp_payout, target_ev_ton)
        if w_j is None:
            print(f"{case['id']:<16} INFEASIBLE — basket EV alone is {basket_ev:.3f}")
            all_ok = False
            continue
        # Build final basket entry list (includes jackpot)
        final_basket = list(basket)
        final_basket.append(
            {"slug": case["jackpot"]["slug"], "weight": w_j, "payout_ton": jp_payout}
        )
        # Verify
        ev = compute_basket_ev(final_basket)
        pct = ev / price * 100
        ok = abs(pct - target_pct) < 0.5
        status = "OK" if ok else "DRIFT"
        print(f"{case['id']:<16} {price:>7.1f} {basket_ev:>10.3f} {w_j:>9.4f} {ev:>9.3f} {pct:>6.2f}% {status:>9}")
        if not ok:
            all_ok = False

        # Persist
        doc = {
            "id": case["id"],
            "name": case["name"],
            "slug": case["slug"],
            "price_ton": price,
            "image_path": case["image_path"],
            "target_ev_pct": target_pct,
            "actual_ev_ton": round(ev, 4),
            "actual_ev_pct": round(pct, 4),
            "house_edge_pct": round(100 - pct, 4),
            "basket": [
                {
                    "slug": b["slug"],
                    "weight": float(b["weight"]),
                    "payout_ton": float(b["payout_ton"]),
                }
                for b in final_basket
            ],
            "enabled": True,
        }
        await cases_col.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)

    print()
    print("All cases OK." if all_ok else "WARNING: some cases drifted.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
