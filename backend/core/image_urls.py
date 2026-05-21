"""
Phase 11.2.5 — shared resolvers for case / item public image URLs.

Originally lived inside `routers/cases.py` (as private `_case_image_url` and
`_item_image_url`).  Moved here because `routers/wheel.py` needs the same
fallback chain to fix the "missing prize icons" regression on prod, and
sharing one canonical implementation is cleaner than re-importing private
helpers across routers.

Public API:

    case_image_url(c: dict) -> str
    item_image_url(it: dict) -> str

Both follow the same priority order:
    1. `image_url` field — used verbatim if non-empty (already absolute,
       either `/api/static/...` or a fully-qualified http(s) URL).
    2. `image_path` field — wrapped via `static_url()` for legacy docs.
    3. Per-slug derivation (`cases/<id>.png` or `items/<slug or id>.png`)
       so even a malformed doc still resolves to the correct artwork.
"""
from __future__ import annotations

from .ton import static_url


def case_image_url(c: dict) -> str:
    """Resolve the public image URL for a case document."""
    url = (c.get("image_url") or "").strip()
    if url:
        return url
    path = (c.get("image_path") or "").strip()
    if path:
        return static_url(path)
    return static_url(f"cases/{c['id']}.png")


def item_image_url(it: dict) -> str:
    """Resolve the public image URL for an item document."""
    url = (it.get("image_url") or "").strip()
    if url:
        return url
    path = (it.get("image_path") or "").strip()
    if path:
        return static_url(path)
    key = (it.get("slug") or it.get("id") or "").strip()
    if key:
        return static_url(f"items/{key}.png")
    # No slug/id at all (shouldn't happen for valid docs) — keep last-resort
    # behaviour stable so legacy code paths don't crash.
    return static_url("items/crate_common.png")
