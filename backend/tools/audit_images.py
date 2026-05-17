"""
Lydomania — image audit tool (Phase 6a).

Walks every item and every case in the DB, verifies that the configured
image returns HTTP 200 with non-zero bytes (after image_url is resolved to
the public preview URL), flags problems, and prints a friendly table.

Usage:
    python -m tools.audit_images            # quick audit
    python -m tools.audit_images --fix      # also re-fetch broken item art from Fragment
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

LOG = logging.getLogger("audit_images")

# Threshold below which we treat a file as "empty / placeholder".
MIN_BYTES_OK = 600
TIMEOUT = 10.0


def _preview_base() -> str:
    """
    Use the same external base URL the frontend uses — that's the surface that
    must serve images to real users. Falls back to localhost for sandbox runs.
    """
    candidates = [
        os.environ.get("PREVIEW_BASE_URL"),
        os.environ.get("PUBLIC_BASE_URL"),
        os.environ.get("MINI_APP_URL"),
    ]
    # Sandbox: read frontend .env
    try:
        env_path = Path("/app/frontend/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("REACT_APP_BACKEND_URL"):
                    candidates.append(line.split("=", 1)[1].strip().strip('"'))
    except Exception:  # noqa: BLE001
        pass
    for c in candidates:
        if c:
            return c.rstrip("/")
    return "http://localhost:8001"


def _resolve(base: str, doc: Optional[dict]) -> Optional[str]:
    """Build the public URL the frontend would resolve for this doc.

    Backend stores `image_path` (e.g. `items/lol_pop.png`) and serves it at
    `{backend}/api/static/{image_path}`. Some legacy rows still carry
    `image_url` as an absolute URL.
    """
    if not doc:
        return None
    url = doc.get("image_url")
    if url:
        if url.startswith("http://") or url.startswith("https://"):
            return url
        if url.startswith("/"):
            return f"{base}{url}"
        return f"{base}/{url}"
    path = doc.get("image_path")
    if path:
        return f"{base}/api/static/{path.lstrip('/')}"
    return None


async def _probe(client: httpx.AsyncClient, url: str) -> tuple[int, int]:
    """Return (status, bytes). Uses GET (some CDNs reject HEAD) but streams body."""
    try:
        r = await client.get(url, timeout=TIMEOUT)
        return r.status_code, len(r.content or b"")
    except httpx.HTTPError as e:
        LOG.debug("probe error %s: %s", url, e)
        return 0, 0


def _classify(status: int, size: int) -> str:
    if status == 0:
        return "NETERR"
    if status >= 400:
        return f"HTTP_{status}"
    if size < MIN_BYTES_OK:
        return "TOO_SMALL"
    return "OK"


async def _audit_collection(
    client: httpx.AsyncClient,
    base: str,
    docs: list[dict[str, Any]],
    kind: str,
    name_key: str = "name",
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for d in docs:
        url = _resolve(base, d)
        if not url:
            rows.append({"kind": kind, "id": d.get("id") or d.get("slug"),
                         "name": d.get(name_key), "url": None,
                         "status": 0, "bytes": 0, "verdict": "NO_URL"})
            continue
        status, size = await _probe(client, url)
        rows.append({"kind": kind, "id": d.get("id") or d.get("slug"),
                     "name": d.get(name_key), "url": url,
                     "status": status, "bytes": size,
                     "verdict": _classify(status, size)})
    return rows


def _print_table(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("  (no rows)")
        return
    by_verdict: dict[str, int] = {}
    for r in rows:
        by_verdict[r["verdict"]] = by_verdict.get(r["verdict"], 0) + 1
    print()
    print(f"{'KIND':6} {'VERDICT':10} {'STATUS':6} {'BYTES':7}  ID / NAME")
    print("-" * 90)
    for r in rows:
        marker = "✓" if r["verdict"] == "OK" else "✗"
        print(f"{marker} {r['kind']:4} {r['verdict']:10} {str(r['status']):6} {r['bytes']:7}  {r['id']} · {r['name']}")
    print("-" * 90)
    parts = [f"{k}={v}" for k, v in sorted(by_verdict.items())]
    print("Summary:  " + "  ".join(parts))


async def _refetch_broken(broken_slugs: list[str]) -> int:
    """Run fetch_base_gift_images for the listed item slugs only."""
    if not broken_slugs:
        return 0
    try:
        from tools.fetch_base_gift_images import fetch_one  # noqa: WPS433
    except ImportError:
        LOG.error("refetch helper unavailable")
        return 0
    LOG.info("Refetching %d item(s) from Fragment …", len(broken_slugs))
    fixed = 0
    with httpx.Client(follow_redirects=True) as client:
        for slug in broken_slugs:
            ok, info = fetch_one(client, slug)
            mark = "✓" if ok else "✗"
            LOG.info("  %s %-24s  %s", mark, slug, info)
            if ok:
                fixed += 1
    return fixed


async def main_async(do_fix: bool) -> int:
    base = _preview_base()
    LOG.info("Probing image URLs against base: %s", base)

    # Reuse the live backend Mongo client so the audit honours whatever the
    # running container sees (works in sandbox or on the VPS via docker exec).
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "lydomania")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    items = await db["items"].find({}, {"_id": 0}).to_list(length=None)
    # Skip disabled / legacy test cases — they're hidden from players and
    # their image files are deliberately absent.
    cases = await db["cases"].find(
        {"$or": [{"enabled": True}, {"enabled": {"$exists": False}}]},
        {"_id": 0},
    ).to_list(length=None)
    skipped = await db["cases"].count_documents({"enabled": False})
    LOG.info(
        "Loaded %d items + %d active cases from MongoDB (%s)  [skipped %d disabled]",
        len(items), len(cases), db_name, skipped,
    )

    async with httpx.AsyncClient(follow_redirects=True) as http:
        item_rows = await _audit_collection(http, base, items, kind="item", name_key="name")
        case_rows = await _audit_collection(http, base, cases, kind="case", name_key="name")

    print("\n===== ITEMS =====")
    _print_table(item_rows)
    print("\n===== CASES =====")
    _print_table(case_rows)

    broken_item_slugs = [r["id"] for r in item_rows if r["verdict"] != "OK"]
    broken_case_ids = [r["id"] for r in case_rows if r["verdict"] != "OK"]

    print()
    if broken_item_slugs:
        print(f"⚠ {len(broken_item_slugs)} item(s) need art: {', '.join(broken_item_slugs[:8])}"
              f"{'…' if len(broken_item_slugs) > 8 else ''}")
    if broken_case_ids:
        print(f"⚠ {len(broken_case_ids)} case(s) have bad cover art: {', '.join(broken_case_ids)}")
    if not broken_item_slugs and not broken_case_ids:
        print("✓ All item and case images are healthy.")

    if do_fix and broken_item_slugs:
        fixed = await _refetch_broken(broken_item_slugs)
        print(f"\n✓ Refetched {fixed}/{len(broken_item_slugs)} item image(s) from Fragment.")
        if broken_case_ids:
            print(f"ℹ  Case covers are bespoke — please regenerate manually: {broken_case_ids}")

    client.close()
    # Non-zero exit only if --fix wasn't passed and something is broken
    return 0 if (not (broken_item_slugs or broken_case_ids)) or do_fix else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix", action="store_true", help="re-fetch broken item art from Fragment")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return asyncio.run(main_async(args.fix))


if __name__ == "__main__":
    sys.exit(main())
