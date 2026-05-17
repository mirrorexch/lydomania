"""
Phase 6a — generate placeholder art for free-case-only consolation items
and the daily free-case cover.

Each item gets a 256x256 PNG with a tinted gradient disc + a glyph + the
item name. Output goes to backend/static/items/{slug}.png and
backend/static/cases/free_case.png. Then we patch each Mongo doc to
reference the new `image_path`.

Run:
    python -m tools.generate_free_case_art
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from motor.motor_asyncio import AsyncIOMotorClient

OUT_ITEMS = Path("/app/backend/static/items")
OUT_CASES = Path("/app/backend/static/cases")
SIZE = 256

# (slug, glyph, hex top, hex bottom, label)
ITEMS = [
    ("zero_ton",       "0",   "#3a4252", "#1a1f2a", "ZERO"),
    ("micro_chip",     "⎔",   "#476074", "#1d2730", "CHIP"),
    ("token_dust",     "✦",   "#5b6d8a", "#22283a", "DUST"),
    ("coin_flip",      "◉",   "#5a8fc5", "#1f3957", "FLIP"),
    ("lucky_ticket",   "♣",   "#7ab3ff", "#2a4a85", "TKT"),
    ("daily_jackpot",  "★",   "#ffd860", "#7a4d18", "JACK"),
]

FREE_CASE = ("free_case", "✦", "#9ab8ff", "#1a2440", "FREE")


def _pick_font(size_pt: int) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            try:
                return ImageFont.truetype(c, size_pt)
            except OSError:
                pass
    return ImageFont.load_default()


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _radial(size: int, top_rgb, bot_rgb) -> Image.Image:
    img = Image.new("RGB", (size, size), bot_rgb)
    cx, cy = size / 2, size / 2
    max_d = ((cx ** 2) + (cy ** 2)) ** 0.5
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = d / max_d
            r = int(top_rgb[0] * (1 - t) + bot_rgb[0] * t)
            g = int(top_rgb[1] * (1 - t) + bot_rgb[1] * t)
            b = int(top_rgb[2] * (1 - t) + bot_rgb[2] * t)
            px[x, y] = (r, g, b)
    return img


def _make(slug: str, glyph: str, top: str, bot: str, label: str, out: Path) -> None:
    base = _radial(SIZE, _hex(top), _hex(bot)).convert("RGBA")

    # Soft glow ring
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    pad = 30
    gd.ellipse([pad, pad, SIZE - pad, SIZE - pad],
               outline=(*_hex(top), 220), width=4)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=4))
    base.alpha_composite(glow)

    # Inner disc
    disc = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    dd = ImageDraw.Draw(disc)
    pad2 = 46
    dd.ellipse([pad2, pad2, SIZE - pad2, SIZE - pad2],
               fill=(*_hex(bot), 210),
               outline=(*_hex(top), 255), width=3)
    base.alpha_composite(disc)

    # Big glyph
    d = ImageDraw.Draw(base)
    g_font = _pick_font(110)
    bbox = d.textbbox((0, 0), glyph, font=g_font)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((SIZE - gw) / 2 - bbox[0], (SIZE - gh) / 2 - bbox[1] - 8),
           glyph, font=g_font, fill=(255, 255, 255, 255))

    # Small label at the bottom
    l_font = _pick_font(20)
    lb = d.textbbox((0, 0), label, font=l_font)
    lw = lb[2] - lb[0]
    d.text(((SIZE - lw) / 2 - lb[0], SIZE - 38),
           label, font=l_font, fill=(255, 255, 255, 220))

    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out, format="PNG", optimize=True)
    print(f"  wrote {out}  ({out.stat().st_size:,} B)")


async def _patch_db() -> None:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "lydomania")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    try:
        for slug, *_ in ITEMS:
            r = await db.items.update_one(
                {"slug": slug},
                {"$set": {"image_path": f"items/{slug}.png", "image_url": ""}},
            )
            print(f"  items.{slug}: matched={r.matched_count} modified={r.modified_count}")
        r = await db.cases.update_one(
            {"id": "free_case"},
            {"$set": {"image_path": "cases/free_case.png", "image_url": ""}},
        )
        print(f"  cases.free_case: matched={r.matched_count} modified={r.modified_count}")
    finally:
        client.close()


def main() -> None:
    print("Generating free-case item art …")
    for slug, glyph, top, bot, label in ITEMS:
        _make(slug, glyph, top, bot, label, OUT_ITEMS / f"{slug}.png")
    print("Generating daily free-case cover …")
    slug, glyph, top, bot, label = FREE_CASE
    _make(slug, glyph, top, bot, label, OUT_CASES / "free_case.png")
    print("Patching Mongo docs …")
    asyncio.run(_patch_db())
    print("Done.")


if __name__ == "__main__":
    main()
