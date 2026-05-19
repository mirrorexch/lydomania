"""
Phase 4b — Seed the Daily Free Case + sample promo codes.

Idempotent: re-running creates missing items / updates the free_case basket,
never duplicates. Promo codes are upsert by code.

Usage:
    cd /app/backend && python -m tools.seed_phase4b
"""
from __future__ import annotations

import asyncio
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


FREE_CASE_ID = "free_case"
FREE_CASE_NAME = "Daily Free Spin"


# Cheap "low-EV" basket. Each item: payout ≤ 1 TON. Target realised EV ≈ 0.06 TON
# (≈$0.05 at current TON price) per spin — a tiny daily-return incentive.
FREE_CASE_BASKET = [
    # slug,          name,            rarity,    payout,  weight
    ("zero_ton",     "Zero TON",      "common",  0.00,    600),   # 60% — no-op spin
    ("micro_chip",   "Micro Chip",    "common",  0.05,    250),   # 25%
    ("token_dust",   "Token Dust",    "common",  0.10,    100),   # 10%
    ("coin_flip",    "Coin Flip",     "rare",    0.30,     35),   # 3.5%
    ("lucky_ticket", "Lucky Ticket",  "rare",    0.75,     12),   # 1.2%
    ("daily_jackpot","Daily Jackpot", "epic",    2.00,      3),   # 0.3%
]


async def upsert_free_case_items(db) -> int:
    """Ensure every basket item exists in `items` collection."""
    n = 0
    for slug, name, rarity, payout, _w in FREE_CASE_BASKET:
        doc = {
            "slug": slug, "name": name, "rarity": rarity,
            "floor_price_ton": float(payout), "is_free_case_only": True,
            "image_url": "",  # frontend falls back to placeholder
        }
        upd = await db.items.find_one_and_update(
            {"slug": slug},
            {"$setOnInsert": doc},
            upsert=True, return_document=False,
        )
        if upd is None:
            n += 1
    return n


async def upsert_free_case(db) -> dict:
    """Create or update the free_case."""
    basket = [{"slug": s, "weight": float(w), "payout_ton": float(p)} for s, _n, _r, p, w in FREE_CASE_BASKET]
    tw = sum(b["weight"] for b in basket)
    ev = sum(b["weight"] * b["payout_ton"] for b in basket) / tw if tw else 0.0
    doc = {
        "id": FREE_CASE_ID,
        "name": FREE_CASE_NAME,
        "price_ton": 0.0,
        "target_ev_pct": 0.0,   # not meaningful for a free case
        "enabled": True,
        "is_daily_free": True,
        "basket": basket,
        "free_spin_cooldown_seconds": 24 * 3600,
        "image_url": "",
    }
    await db.cases.update_one({"id": FREE_CASE_ID}, {"$set": doc}, upsert=True)
    return {"id": FREE_CASE_ID, "basket_size": len(basket), "expected_ev_ton": round(ev, 4)}


async def upsert_sample_promos(db) -> int:
    """Idempotently create three sample promo codes for the operator to play with."""
    samples = [
        {"code": "WELCOME5", "type": "ton_bonus", "value": 5.0,
         "max_redemptions": 1000, "user_max": 1, "notes": "First-touch onboarding bonus"},
        {"code": "FREESPIN", "type": "free_spin_token", "value": 1,
         "max_redemptions": 0, "user_max": 3, "notes": "Bypass 24h cooldown — three tokens per user"},
        {"code": "PHASE4B", "type": "ton_bonus", "value": 1.0,
         "max_redemptions": 100, "user_max": 1, "notes": "Beta-launch thank-you (limit 100)"},
    ]
    from core.time_utils import iso, now  # local import — script context
    inserted = 0
    for s in samples:
        existing = await db.promo_codes.find_one({"code": s["code"]}, {"_id": 0, "id": 1})
        if existing:
            continue
        doc = {
            "id": secrets.token_hex(10),
            "code": s["code"], "type": s["type"], "value": s["value"],
            "max_redemptions": s["max_redemptions"], "current_redemptions": 0,
            "user_max": s["user_max"],
            "expires_at": None, "enabled": True,
            "notes": s["notes"],
            "created_by_admin": 100000001,
            "created_at": iso(now()), "updated_at": iso(now()),
        }
        await db.promo_codes.insert_one(doc)
        inserted += 1
    return inserted


async def main() -> None:
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    items_added = await upsert_free_case_items(db)
    case = await upsert_free_case(db)
    promos_added = await upsert_sample_promos(db)
    print("=== seed_phase4b ===")
    print(f"  items added (insertOnInsert): {items_added}")
    print(f"  free_case: {case}")
    print(f"  promos added: {promos_added}  (samples: WELCOME5, FREESPIN, PHASE4B)")


if __name__ == "__main__":
    asyncio.run(main())
