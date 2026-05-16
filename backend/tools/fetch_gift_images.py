"""
Fetch authentic Telegram NFT gift preview images for every Lydomania item.

Strategy:
  1. Try https://t.me/nft/{CamelCaseName}-{n} for n in 1..6, scrape og:image,
     download.
  2. Skip items whose static/items/{slug}.png already exists AND is bigger
     than the rarity fallback (>40KB heuristic).
  3. Report coverage at the end and update seed_data/items.json + DB.

Run:
    python -m tools.fetch_gift_images
    python -m tools.seed_db   # to push updates to MongoDB
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "seed_data"
STATIC_ITEMS = ROOT / "static" / "items"
STATIC_ITEMS.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126 Safari/537.36"
    )
}

OG_RE = re.compile(
    r'<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


def to_camel(name: str) -> str:
    # "Durov's Cap" -> "DurovsCap"
    cleaned = re.sub(r"[^A-Za-z0-9 ]+", "", name)
    parts = [p for p in cleaned.split() if p]
    return "".join(p[:1].upper() + p[1:] for p in parts)


async def _try_one(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        r = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=15.0)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    m = OG_RE.search(r.text)
    if not m:
        return None
    img_url = m.group(1)
    # Telegram returns the gift previews via OG. Validate roughly: has "telesco" or
    # ".jpg"/".png".
    if not re.search(r"telesco\.pe|cdn-telegram|\.jpg|\.png|\.webp", img_url):
        return None
    return img_url


async def _download(client: httpx.AsyncClient, url: str, dest: Path) -> int:
    r = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=30.0)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return len(r.content)


async def fetch_for_item(
    client: httpx.AsyncClient, item: dict
) -> tuple[str, str | None]:
    """
    Returns ("slug", "source") where source is "telegram", "skipped", or None.
    """
    slug = item["slug"]
    name = item["name"]
    dest = STATIC_ITEMS / f"{slug}.png"
    if dest.exists() and dest.stat().st_size > 40_000:
        return slug, "skipped"

    camel = to_camel(name)
    for n in range(1, 7):
        url = f"https://t.me/nft/{camel}-{n}"
        img = await _try_one(client, url)
        if img:
            try:
                await _download(client, img, dest)
                return slug, "telegram"
            except httpx.HTTPError:
                continue
    return slug, None


async def main(args: argparse.Namespace) -> int:
    items = json.loads((SEED_DIR / "items.json").read_text())
    item_list = items["items"]
    print(f"Fetching artwork for {len(item_list)} items …")

    results: dict[str, str | None] = {}
    rarity_to_crate = {
        "common": "items/crate_common.png",
        "rare": "items/crate_rare.png",
        "epic": "items/crate_epic.png",
        "legendary": "items/crate_legendary.png",
        "mythic": "items/crate_mythic.png",
        "jackpot": "items/crate_jackpot.png",
    }

    async with httpx.AsyncClient() as client:
        # Process in small batches to avoid hammering Telegram
        batch = 6
        for i in range(0, len(item_list), batch):
            chunk = item_list[i : i + batch]
            outs = await asyncio.gather(
                *(fetch_for_item(client, it) for it in chunk),
                return_exceptions=True,
            )
            for it, out in zip(chunk, outs):
                slug = it["slug"]
                if isinstance(out, Exception):
                    results[slug] = None
                    print(f"  {slug:<22} ERROR {out}")
                    continue
                _, src = out
                results[slug] = src
                tag = {
                    "telegram": "✓ telegram",
                    "skipped": "· skipped (exists)",
                    None: "✗ FALLBACK to rarity crate",
                }[src]
                print(f"  {slug:<22} {tag}")

    # Update seed JSON with per-item image_path
    for it in item_list:
        slug = it["slug"]
        src = results.get(slug)
        if src in ("telegram", "skipped"):
            it["image_path"] = f"items/{slug}.png"
        else:
            it["image_path"] = rarity_to_crate.get(it["rarity"], "items/crate_common.png")

    if args.write:
        (SEED_DIR / "items.json").write_text(json.dumps(items, indent=2))
        print(f"\nWrote updated image_path back to {SEED_DIR / 'items.json'}")

    n_tg = sum(1 for v in results.values() if v == "telegram")
    n_skip = sum(1 for v in results.values() if v == "skipped")
    n_fail = sum(1 for v in results.values() if v is None)
    total = len(results)
    print(
        f"\nSummary: telegram={n_tg}  cached={n_skip}  fallback={n_fail}  "
        f"total={total}  authentic_coverage={(n_tg + n_skip) / total * 100:.1f}%"
    )
    if n_fail:
        print("\nFell back to rarity crate for:")
        for slug, src in results.items():
            if src is None:
                print(f"  - {slug}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write image_path back to items.json")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args)))
