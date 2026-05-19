"""
Phase 6b — case categories migration + Whale Vault seeding + recalibration.

Run once after deploying Phase 6b code:
    python -m tools.migrate_phase6b

What it does:
  1. Sets `category` field on every existing case
       free_case → "free"
       stickers_box, premium_pack → "low"
       royal_chest, diamond_vault → "middle"
       mythic_crown → "high"
  2. Seeds (or updates) the new "Whale Vault" case (id=whale_vault, 500 TON, "high")
     with a hand-picked basket of high-end items + a jackpot.
  3. Recalibrates every enabled case to 90% RTP with payout cap = 200×price
     (drops items whose floor > 200× the case price → keeps solvency sane).
  4. Re-emits the actual EV % per case for verification.

Idempotent: safe to re-run.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

# Reuse the live calibration service so we follow the same math as the admin UI.
from services.recalibration import recalibrate_case  # type: ignore[import-not-found]
from core.time_utils import iso, now  # type: ignore[import-not-found]


CATEGORY_MAP: dict[str, str] = {
    "free_case":     "free",
    "stickers_box":  "low",      # 10 TON
    "premium_pack":  "low",      # 25 TON
    "royal_chest":   "middle",   # 50 TON
    "diamond_vault": "middle",   # 100 TON
    "mythic_crown":  "high",     # 250 TON
    "whale_vault":   "high",     # 500 TON (new)
}


# Hand-picked Whale Vault basket. Slugs must already exist in `items` collection.
# We tag them with rough TON tiers so the recalibration can rebalance to 90% RTP.
# Payouts are starting points; recalibrate_case will rewrite them using live floors.
WHALE_VAULT_BASKET: list[dict[str, Any]] = [
    {"slug": "lol_pop",         "weight": 250.0, "payout_ton":   60.0},
    {"slug": "lunar_snake",     "weight": 200.0, "payout_ton":  100.0},
    {"slug": "winter_wreath",   "weight": 150.0, "payout_ton":  180.0},
    {"slug": "homemade_cake",   "weight": 120.0, "payout_ton":  220.0},
    {"slug": "santa_sleigh",    "weight":  80.0, "payout_ton":  400.0},
    {"slug": "magic_book",      "weight":  60.0, "payout_ton":  500.0},
    {"slug": "tag_heuer",       "weight":  45.0, "payout_ton":  700.0},
    {"slug": "scared_doll",     "weight":  30.0, "payout_ton": 1000.0},
    {"slug": "snake_lord",      "weight":  20.0, "payout_ton": 1500.0},
    {"slug": "durov_cap",       "weight":  10.0, "payout_ton": 3000.0},
    {"slug": "loot_sword",      "weight":   6.0, "payout_ton": 5000.0},
    {"slug": "ton_relic",       "weight":   4.0, "payout_ton": 8000.0},
    {"slug": "plush_pepe",      "weight":   2.0, "payout_ton": 12000.0},
    {"slug": "heart_of_ton",    "weight":   1.0, "payout_ton": 25000.0},  # jackpot
]


async def _set_categories(db) -> dict[str, int]:
    """Apply CATEGORY_MAP to existing case docs."""
    counts: dict[str, int] = {"updated": 0, "missing": 0}
    for case_id, cat in CATEGORY_MAP.items():
        r = await db.cases.update_one({"id": case_id}, {"$set": {"category": cat}})
        if r.matched_count:
            counts["updated"] += int(r.modified_count or 0)
        else:
            counts["missing"] += 1
    return counts


async def _seed_whale_vault(db) -> dict[str, Any]:
    """Insert or update the Whale Vault (id=whale_vault). Idempotent."""
    case_id = "whale_vault"
    existing = await db.cases.find_one({"id": case_id}, {"_id": 0})

    # Filter basket to only items that exist in DB
    slugs = [b["slug"] for b in WHALE_VAULT_BASKET]
    have = {d["slug"] async for d in db.items.find(
        {"slug": {"$in": slugs}}, {"_id": 0, "slug": 1},
    )}
    missing = [s for s in slugs if s not in have]
    basket = [b for b in WHALE_VAULT_BASKET if b["slug"] in have]

    doc = {
        "id": case_id,
        "name": "Whale Vault",
        "slug": case_id,
        "price_ton": 500.0,
        "category": "high",
        "image_path": "cases/whale_vault.png",
        "image_url": "",
        "target_ev_pct": 90.0,
        "enabled": True,
        "basket": basket,
        "updated_at": iso(now()),
    }
    if not existing:
        doc["created_at"] = iso(now())
        await db.cases.insert_one(doc)
        action = "inserted"
    else:
        await db.cases.update_one({"id": case_id}, {"$set": doc})
        action = "updated"
    return {"action": action, "basket_size": len(basket), "missing_items": missing}


async def _generate_whale_vault_cover() -> str:
    """Write a procedural cover PNG for Whale Vault."""
    out = os.path.join(os.environ.get("STATIC_DIR", "/app/backend/static"),
                       "cases", "whale_vault.png")
    if os.path.exists(out) and os.path.getsize(out) > 5000:
        return f"exists ({os.path.getsize(out)}B)"

    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    size = 512

    def hexcol(h: str) -> tuple[int, int, int]:
        h = h.lstrip("#")
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    # Radial gradient (gold → deep navy)
    top = hexcol("#FFD860")
    bot = hexcol("#1a1233")
    img = Image.new("RGB", (size, size), bot)
    cx = cy = size / 2
    md = ((cx ** 2) + (cy ** 2)) ** 0.5
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = d / md
            r = int(top[0] * (1 - t) + bot[0] * t)
            g = int(top[1] * (1 - t) + bot[1] * t)
            b = int(top[2] * (1 - t) + bot[2] * t)
            px[x, y] = (r, g, b)
    img = img.convert("RGBA")

    # Soft outer glow
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([40, 40, size - 40, size - 40],
               outline=(*top, 220), width=8)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=8))
    img.alpha_composite(glow)

    # Inner disc
    d = ImageDraw.Draw(img)
    d.ellipse([90, 90, size - 90, size - 90],
              fill=(*bot, 240), outline=(*top, 255), width=4)

    # Crown glyph
    font_path = None
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if os.path.exists(p):
            font_path = p
            break
    f_glyph = ImageFont.truetype(font_path, 240) if font_path else ImageFont.load_default()
    bbox = d.textbbox((0, 0), "♛", font=f_glyph)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - gw) / 2 - bbox[0], (size - gh) / 2 - bbox[1] - 20),
           "♛", font=f_glyph, fill=(255, 255, 255, 255))

    # Label
    f_label = ImageFont.truetype(font_path, 38) if font_path else ImageFont.load_default()
    label = "WHALE VAULT"
    lb = d.textbbox((0, 0), label, font=f_label)
    lw = lb[2] - lb[0]
    d.text(((size - lw) / 2 - lb[0], size - 90), label,
           font=f_label, fill=(255, 255, 255, 240))

    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, format="PNG", optimize=True)
    return f"created ({os.path.getsize(out)}B)"


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "lydomania")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    try:
        print("=== Phase 6b — case categories migration ===\n")

        print("[1/4] Tagging existing cases with category…")
        r = await _set_categories(db)
        print(f"    updated={r['updated']}  missing_cases={r['missing']}")

        print("\n[2/4] Generating Whale Vault cover image…")
        cover = await _generate_whale_vault_cover()
        print(f"    {cover}")

        print("\n[3/4] Seeding/updating Whale Vault case…")
        wv = await _seed_whale_vault(db)
        print(f"    {wv['action']} · basket={wv['basket_size']} items"
              f"{' · missing=' + str(wv['missing_items']) if wv['missing_items'] else ''}")

        print("\n[4/4] Recalibrating every enabled paid case to 90% RTP (cap=200×price)…")
        enabled = [c async for c in db.cases.find(
            {"enabled": True, "price_ton": {"$gt": 0}}, {"_id": 0, "id": 1, "name": 1},
        )]
        results: list[tuple[str, float, str]] = []
        for c in enabled:
            try:
                rep = await recalibrate_case(
                    c["id"], max_payout_multiplier=200.0,
                    min_basket_size=4, apply=True,
                )
                if not rep.get("ok"):
                    results.append((c["id"], 0.0, f"fail: {rep.get('error', 'unknown')}"))
                    print(f"    ✗ {c['id']:<14}  FAILED  {rep.get('error', 'unknown')}")
                    continue
                actual = float(rep.get("realized_ev_pct") or 0.0)
                results.append((c["id"], actual, "ok"))
                print(f"    ✓ {c['id']:<14}  EV={actual:6.2f}%  "
                      f"jackpot={rep.get('jackpot_slug')}  "
                      f"kept={rep.get('kept_count')}/{rep.get('kept_count', 0) + rep.get('dropped_count', 0)}")
            except Exception as e:  # noqa: BLE001
                results.append((c["id"], 0.0, f"fail: {e}"))
                print(f"    ✗ {c['id']:<14}  FAILED  {e}")

        print("\n=== Summary ===")
        for cid, ev, status in results:
            drift = abs(ev - 90.0)
            mark = "✓" if drift <= 0.5 else "⚠" if drift <= 2.0 else "✗"
            print(f"  {mark} {cid:<14}  EV={ev:6.2f}%  drift={drift:.2f}pp  {status}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
