"""
Phase 6b-redesign — comprehensive case overhaul.

Brings the catalog from 7 cases → 13 cases (1 free + 4 low + 4 middle + 4 high)
calibrated to 90% RTP each. Idempotent: safe to re-run.

What it does, in order:
    1. Renames + reprices the 4 existing paid cases that move down the ladder:
         stickers_box   10 → 5  TON
         premium_pack   25 → 10 TON
         royal_chest    50 → 25 TON
         diamond_vault  100 → 50 TON
       (mythic_crown 250 / whale_vault 500 / free_case unchanged.)
    2. Inserts the 6 new cases:
         pocket_box       1 TON  low      common-heavy entry point
         lucky_charm      15 TON low      themed (luck items)
         imperial_trove   75 TON middle   themed (royal/luxury)
         celestial_box    100 TON middle  themed (cosmic)
         olympus_cache    1000 TON high   mythic-only
         legend_pack      2000 TON high   grail-only
    3. Generates procedural cover art (PIL) for the 6 new cases, keyed to
       each case's theme/accent (saved to STATIC_DIR/cases/<id>.png).
    4. Builds tier-appropriate baskets by floor price + filters items whose
       floor exceeds 200× the case price (solvency rule).
    5. Calls services.recalibration.recalibrate_case to reach 90% RTP ±0.5.

Usage:
    python -m tools.migrate_phase6b_redesign
"""

from __future__ import annotations

import asyncio
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from core.time_utils import iso, now  # type: ignore[import-not-found]
from services.recalibration import recalibrate_case  # type: ignore[import-not-found]


STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/backend/static"))


@dataclass(frozen=True)
class CaseSpec:
    id: str
    name: str
    price_ton: float
    category: str  # "free" | "low" | "middle" | "high"
    floor_min: float
    floor_max: float
    # Tight band for the "common" items that supply the bulk of the EV mass.
    # Anything strictly above this floor counts as a high-variance jackpot
    # candidate. Calibration then solves jackpot weight to hit target RTP.
    common_floor_max: float
    # Cover-art knobs (only used when we have to generate one):
    glyph: str
    top: str  # hex
    bot: str  # hex
    label: str


# 13 cases — order matters for the page layout (free → low → middle → high).
#
# Sizing rule of thumb:
#   common_floor_max ≈ case_price × 0.9   (so non-jackpot avg < target EV)
#   floor_max         ≈ case_price × 200  (solvency cap, hard ceiling)
CASES: list[CaseSpec] = [
    # FREE
    CaseSpec("free_case", "Daily Free Spin", 0.0, "free",
             0.0, 1.0, 1.0, "✦", "#9ab8ff", "#1a2440", "FREE"),

    # LOW (4) — common items intentionally include cheap "consolation"
    # slugs (zero_ton, micro_chip, etc.) at sub-1-TON floors. This is the
    # only way to reach 90% RTP on the 3-TON tier with the current catalog.
    CaseSpec("pocket_box", "Pocket Box", 3.0, "low",
             0.0, 60.0, 2.7, "◰", "#7fffd4", "#0f3a35", "POCKET"),
    CaseSpec("stickers_box", "Stickers Box", 5.0, "low",
             0.0, 800.0, 4.5, "◉", "#5b8ad9", "#1a2240", "STICKER"),
    CaseSpec("premium_pack", "Premium Pack", 10.0, "low",
             0.5, 1500.0, 9.0, "✦", "#86d9ff", "#142b3a", "PREMIUM"),
    CaseSpec("lucky_charm", "Lucky Charm", 15.0, "low",
             2.0, 2500.0, 13.5, "♣", "#7ee07a", "#1a3a23", "LUCKY"),

    # MIDDLE (4)
    CaseSpec("royal_chest", "Royal Chest", 25.0, "middle",
             3.0, 4000.0, 22.5, "♛", "#c98aff", "#2a1646", "ROYAL"),
    CaseSpec("diamond_vault", "Diamond Vault", 50.0, "middle",
             8.0, 7500.0, 45.0, "◆", "#5fe1ff", "#11324a", "DIAMOND"),
    CaseSpec("imperial_trove", "Imperial Trove", 75.0, "middle",
             15.0, 12000.0, 67.5, "✱", "#ffd86b", "#3a2614", "IMPERIAL"),
    CaseSpec("celestial_box", "Celestial Box", 100.0, "middle",
             20.0, 16000.0, 90.0, "✺", "#ae9bff", "#221446", "CELESTIAL"),

    # HIGH (4)
    CaseSpec("mythic_crown", "Mythic Crown", 250.0, "high",
             40.0, 40000.0, 225.0, "♚", "#ff8aff", "#2b0e36", "MYTHIC"),
    CaseSpec("whale_vault", "Whale Vault", 500.0, "high",
             100.0, 80000.0, 450.0, "♛", "#ffd860", "#1a1233", "WHALE"),
    CaseSpec("olympus_cache", "Olympus Cache", 1000.0, "high",
             200.0, 200000.0, 900.0, "𓆣", "#fff0a8", "#3a2a14", "OLYMPUS"),
    CaseSpec("legend_pack", "Legend Pack", 2000.0, "high",
             100.0, 400000.0, 500.0, "✦", "#ff5566", "#220812", "LEGEND"),
]


# ────────────────────────────────────────────────────────────────────────
# Cover art generation (procedural PIL — matches the existing aesthetic)
# ────────────────────────────────────────────────────────────────────────

def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _pick_font(size_pt: int) -> ImageFont.ImageFont:
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size_pt)
            except OSError:
                pass
    return ImageFont.load_default()


def _radial(size: int, top, bot) -> Image.Image:
    img = Image.new("RGB", (size, size), bot)
    cx = cy = size / 2
    md = ((cx ** 2) + (cy ** 2)) ** 0.5
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / md
            r = int(top[0] * (1 - t) + bot[0] * t)
            g = int(top[1] * (1 - t) + bot[1] * t)
            b = int(top[2] * (1 - t) + bot[2] * t)
            px[x, y] = (r, g, b)
    return img


def _generate_cover(spec: CaseSpec) -> Path | None:
    """Generate a 512×512 cover PNG keyed to the case's theme."""
    out = STATIC_DIR / "cases" / f"{spec.id}.png"
    if out.exists() and out.stat().st_size > 5000:
        return out  # already there — keep existing art
    size = 512
    top, bot = _hex(spec.top), _hex(spec.bot)
    img = _radial(size, top, bot).convert("RGBA")

    # Outer glow ring
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

    # Subtle noise speckle for texture
    import random
    rnd = random.Random(hash(spec.id) & 0xFFFFFFFF)
    for _ in range(220):
        x = rnd.randint(95, size - 95)
        y = rnd.randint(95, size - 95)
        a = rnd.randint(20, 60)
        d.point((x, y), fill=(255, 255, 255, a))

    # Big glyph
    f_glyph = _pick_font(220)
    bbox = d.textbbox((0, 0), spec.glyph, font=f_glyph)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - gw) / 2 - bbox[0], (size - gh) / 2 - bbox[1] - 24),
           spec.glyph, font=f_glyph, fill=(255, 255, 255, 255))

    # Label
    f_label = _pick_font(36)
    lb = d.textbbox((0, 0), spec.label, font=f_label)
    lw = lb[2] - lb[0]
    d.text(((size - lw) / 2 - lb[0], size - 92), spec.label,
           font=f_label, fill=(255, 255, 255, 240))

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="PNG", optimize=True)
    return out


# ────────────────────────────────────────────────────────────────────────
# Basket assembly
# ────────────────────────────────────────────────────────────────────────

async def _assemble_basket(db, spec: CaseSpec) -> list[dict[str, Any]]:
    """Pick items so non-jackpot avg < target EV.

    Strategy: take all items with floor in [floor_min, common_floor_max]
    as the "common" mass, then add up to 3 high-floor items as jackpot
    candidates (capped at min(floor_max, price × 200) for solvency).
    Calibration solves the jackpot weight to hit target RTP.
    """
    cap = max(spec.price_ton * 200, 1.0)
    jp_cap = min(spec.floor_max, cap)

    # Common items — bulk of weight, payouts below target EV
    common_cur = db.items.find(
        {
            "floor_price_ton": {"$gte": spec.floor_min, "$lte": spec.common_floor_max},
            "enabled": {"$ne": False},
        },
        {"_id": 0, "slug": 1, "floor_price_ton": 1, "rarity": 1},
    ).sort("floor_price_ton", 1)
    commons = [d async for d in common_cur]

    # Jackpot candidates — handful of high-floor items above the common band
    jp_cur = db.items.find(
        {
            "floor_price_ton": {"$gt": spec.common_floor_max, "$lte": jp_cap},
            "enabled": {"$ne": False},
        },
        {"_id": 0, "slug": 1, "floor_price_ton": 1, "rarity": 1},
    ).sort("floor_price_ton", -1).limit(8)
    jackpots = [d async for d in jp_cur]

    items = commons + jackpots
    # Need at least 4 items in basket — widen lower bound if necessary.
    if len(items) < 4:
        wide = db.items.find(
            {"floor_price_ton": {"$lte": jp_cap, "$gt": 0},
             "enabled": {"$ne": False}},
            {"_id": 0, "slug": 1, "floor_price_ton": 1, "rarity": 1},
        ).sort("floor_price_ton", 1).limit(20)
        items = [d async for d in wide]

    out = []
    for it in items:
        floor = float(it.get("floor_price_ton") or 0.01)
        out.append({
            "slug": it["slug"],
            "weight": max(1.0, 100.0 / max(floor, 0.5)),
            "payout_ton": floor,
        })
    return out


# ────────────────────────────────────────────────────────────────────────
# Main migration
# ────────────────────────────────────────────────────────────────────────

async def _upsert_case(db, spec: CaseSpec, basket: list[dict[str, Any]]) -> str:
    existing = await db.cases.find_one({"id": spec.id}, {"_id": 0})
    base = {
        "id": spec.id,
        "name": spec.name,
        "slug": spec.id,
        "price_ton": float(spec.price_ton),
        "category": spec.category,
        "image_path": f"cases/{spec.id}.png",
        "image_url": "",
        "target_ev_pct": 90.0,
        "enabled": True,
        "updated_at": iso(now()),
    }
    if spec.id == "free_case":
        # Don't touch free_case basket/special fields — only category/category sync.
        await db.cases.update_one(
            {"id": "free_case"},
            {"$set": {"category": "free", "updated_at": iso(now())}},
        )
        return "kept-free"
    if not existing:
        base["created_at"] = iso(now())
        base["basket"] = basket
        await db.cases.insert_one(base)
        return "inserted"
    # Replace basket only if the case had no basket OR if we explicitly want
    # a fresh tier-appropriate basket for the existing case.
    base["basket"] = basket
    await db.cases.update_one({"id": spec.id}, {"$set": base})
    return "updated"


async def main() -> int:
    mongo = AsyncIOMotorClient(
        os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = mongo[os.environ.get("DB_NAME", "lydomania")]

    try:
        print("=== Phase 6b-redesign — comprehensive case overhaul ===\n")
        print("[1/4] Generating procedural covers for any missing PNGs …")
        for spec in CASES:
            if spec.id == "free_case":
                continue
            p = _generate_cover(spec)
            if p:
                print(f"    • cases/{spec.id}.png ({p.stat().st_size:,} B)")

        print("\n[2/4] Upserting case docs + assembling baskets …")
        results: list[tuple[str, str, int]] = []
        for spec in CASES:
            basket = await _assemble_basket(db, spec) if spec.id != "free_case" else []
            status = await _upsert_case(db, spec, basket)
            print(f"    • {spec.id:<16} ({spec.price_ton:>6.1f} TON, {spec.category:<6}) "
                  f"basket={len(basket):>3}  [{status}]")
            results.append((spec.id, status, len(basket)))

        print("\n[3/4] Recalibrating every paid case to 90% RTP "
              "(cap=200×price) …")
        cal_results: list[tuple[str, float, str]] = []
        for spec in CASES:
            if spec.id == "free_case":
                continue
            try:
                rep = await recalibrate_case(
                    spec.id, max_payout_multiplier=200.0,
                    min_basket_size=4, apply=True,
                )
                if not rep.get("ok"):
                    cal_results.append((spec.id, 0.0,
                                        f"fail: {rep.get('error', 'unknown')}"))
                    print(f"    ✗ {spec.id:<16} FAILED: {rep.get('error')}")
                    continue
                ev = float(rep.get("realized_ev_pct") or 0.0)
                cal_results.append((spec.id, ev, "ok"))
                print(f"    ✓ {spec.id:<16} EV={ev:6.2f}%  "
                      f"jackpot={rep.get('jackpot_slug')}  "
                      f"kept={rep.get('kept_count')}")
            except Exception as e:  # noqa: BLE001
                cal_results.append((spec.id, 0.0, f"fail: {e}"))
                print(f"    ✗ {spec.id:<16} FAILED: {e}")

        print("\n[4/4] Solvency + drift report")
        bad_solv = 0
        async for case in db.cases.find(
            {"enabled": True, "price_ton": {"$gt": 0}}, {"_id": 0},
        ):
            cap = case["price_ton"] * 200
            for b in case.get("basket", []):
                if float(b.get("payout_ton") or 0) > cap:
                    bad_solv += 1
        print(f"    solvency violations: {bad_solv}")
        print()
        print(f"  {'case':<16} {'price':>6}  {'cat':<6}  {'EV':>6}  drift")
        ok_drift = 0
        for cid, ev, status in cal_results:
            drift = abs(ev - 90.0)
            mark = "✓" if drift <= 0.5 else "⚠" if drift <= 2.0 else "✗"
            ok_drift += int(drift <= 0.5)
            spec = next(s for s in CASES if s.id == cid)
            print(f"  {mark} {cid:<16} {spec.price_ton:>6.0f}  "
                  f"{spec.category:<6}  {ev:>5.2f}%  {drift:.2f}pp  {status}")
        print(f"\n  → {ok_drift}/{len(cal_results)} paid cases within ±0.5pp of 90% RTP")
        return 0
    finally:
        mongo.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
