"""
Lydomania — fetch BASE (non-upgraded) Telegram gift thumbnails from Fragment.

Each collectible gift on Fragment exposes a static thumbnail at:
    https://fragment.com/file/gifts/{slug}/thumb.webp

This is the canonical "default" sticker — no backdrops, no symbols, no NFT serial.
Exactly the asset every user sees when they receive a normal gift before upgrading.

Usage:
    python -m tools.fetch_base_gift_images
"""

from __future__ import annotations

import io
import json
import logging
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

LOG = logging.getLogger("fetch_base_gifts")
ROOT = Path(__file__).resolve().parent.parent  # /app/backend
SEED_JSON = ROOT / "seed_data" / "items.json"
IMG_DIR = ROOT / "static" / "items"

FRAGMENT_URL = "https://fragment.com/file/gifts/{slug}/thumb.webp"
UA = "Mozilla/5.0 (compatible; LydomaniaBot/1.0)"
TIMEOUT = 15.0

# Our slug → Fragment slug (Fragment uses no separators, lowercase)
# Default rule: lowercase + strip underscores; overrides below for the few divergent names.
OVERRIDES: dict[str, str] = {
    "durov_cap": "durovscap",  # "Durov's Cap" -> durovscap on Fragment
    "westside_sign": "westsidesign",
    "tama_gadget": "tamagadget",
}


def our_to_fragment_slug(slug: str) -> str:
    return OVERRIDES.get(slug, slug.replace("_", "").lower())


def webp_bytes_to_png(data: bytes, max_side: int = 512) -> bytes:
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    # Trim transparent border, then center on a square canvas for a clean tile look
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    if max(img.size) > max_side:
        scale = max_side / max(img.size)
        img = img.resize(
            (int(img.size[0] * scale), int(img.size[1] * scale)),
            Image.LANCZOS,
        )
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2), img)
    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()


def fetch_one(client: httpx.Client, our_slug: str) -> tuple[bool, str]:
    """Return (success, info_string)."""
    frag = our_to_fragment_slug(our_slug)
    url = FRAGMENT_URL.format(slug=frag)
    try:
        r = client.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        return False, f"network: {e}"
    if r.status_code != 200 or not r.content:
        return False, f"http {r.status_code}, {len(r.content)}b"
    try:
        png = webp_bytes_to_png(r.content)
    except Exception as e:  # noqa: BLE001
        return False, f"convert: {e}"
    out_path = IMG_DIR / f"{our_slug}.png"
    out_path.write_bytes(png)
    return True, f"{frag}.webp → {our_slug}.png ({len(png)//1024} KB)"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    data = json.loads(SEED_JSON.read_text())
    items = data["items"]
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    LOG.info("Fetching %d base gift thumbnails from Fragment …", len(items))
    ok: list[str] = []
    fail: list[tuple[str, str]] = []

    with httpx.Client(http2=False, follow_redirects=True) as client:
        for it in items:
            slug = it["slug"]
            success, info = fetch_one(client, slug)
            if success:
                ok.append(slug)
                LOG.info("  ✓ %-24s %s", slug, info)
            else:
                fail.append((slug, info))
                LOG.warning("  ✗ %-24s %s", slug, info)
            time.sleep(0.15)  # be polite to fragment.com

    # Mark missing items in seed (in-memory only — we don't rewrite seed_data so EV stays stable)
    if fail:
        for slug, why in fail:
            for it in items:
                if it["slug"] == slug:
                    it["_needs_art"] = True
                    it["_fetch_error"] = why

    LOG.info("")
    LOG.info("=" * 60)
    LOG.info("DONE  · ok=%d / %d  · failed=%d", len(ok), len(items), len(fail))
    if fail:
        LOG.info("Failed items:")
        for slug, why in fail:
            LOG.info("  - %s  (%s)", slug, why)
    LOG.info("Images written to: %s", IMG_DIR)
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())
