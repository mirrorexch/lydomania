"""Admin items CRUD (Phase 3a) + image upload + refetch-from-fragment."""
from __future__ import annotations

import io
import secrets
from typing import Any, Optional

import httpx
from PIL import Image
from fastapi import File, Form, HTTPException, Query, UploadFile

from core.config import STATIC_DIR
from core.db import cases_col, inventory_col, items_col
from core.models import AdminItemIn, AdminItemOut, AdminItemPatchIn
from core.time_utils import iso, now
from core.ton import static_url
from routers.admin import admin


# Mirrors tools/fetch_base_gift_images.py overrides
FRAGMENT_OVERRIDES = {"durov_cap": "durovscap", "westside_sign": "westsidesign", "tama_gadget": "tamagadget"}


def _fragment_slug(slug: str) -> str:
    return FRAGMENT_OVERRIDES.get(slug, slug.replace("_", "").lower())


def _item_to_out(d: dict, cases_using: int = 0) -> AdminItemOut:
    return AdminItemOut(
        id=d.get("id", d["slug"]),
        slug=d["slug"], name=d["name"], rarity=d["rarity"],
        floor_price_ton=float(d.get("floor_price_ton", 0.0)),
        image_path=d.get("image_path"),
        image_url=static_url(d.get("image_path") or f"items/crate_{d.get('rarity', 'common')}.png"),
        cases_using=cases_using,
    )


async def _cases_using_count(slug: str) -> int:
    return await cases_col.count_documents({"basket.slug": slug})


@admin.get("/items", response_model=list[AdminItemOut])
async def admin_list_items(
    rarity: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[AdminItemOut]:
    q: dict[str, Any] = {}
    if rarity and rarity != "all":
        q["rarity"] = rarity
    if search:
        q["$or"] = [
            {"slug": {"$regex": search, "$options": "i"}},
            {"name": {"$regex": search, "$options": "i"}},
        ]
    out: list[AdminItemOut] = []
    cur = items_col.find(q, {"_id": 0}).sort([("rarity", 1), ("name", 1)]).skip(offset).limit(limit)
    async for d in cur:
        out.append(_item_to_out(d, await _cases_using_count(d["slug"])))
    return out


@admin.post("/items", response_model=AdminItemOut)
async def admin_create_item(payload: AdminItemIn) -> AdminItemOut:
    if await items_col.find_one({"slug": payload.slug}, {"_id": 0}):
        raise HTTPException(status_code=409, detail=f"item slug '{payload.slug}' already exists")
    doc = {
        "id": payload.slug, "slug": payload.slug, "name": payload.name,
        "rarity": payload.rarity, "floor_price_ton": float(payload.floor_price_ton),
        "image_path": payload.image_path or f"items/{payload.slug}.png",
        "created_at": iso(now()),
    }
    await items_col.insert_one(doc)
    return _item_to_out(doc, 0)


@admin.patch("/items/{slug}", response_model=AdminItemOut)
async def admin_patch_item(slug: str, patch: AdminItemPatchIn) -> AdminItemOut:
    item = await items_col.find_one({"slug": slug}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="item not found")
    upd: dict[str, Any] = {"updated_at": iso(now())}
    for k in ("name", "rarity", "floor_price_ton", "image_path"):
        v = getattr(patch, k, None)
        if v is not None:
            upd[k] = v
    await items_col.update_one({"slug": slug}, {"$set": upd})
    fresh = await items_col.find_one({"slug": slug}, {"_id": 0})
    return _item_to_out(fresh, await _cases_using_count(slug))


@admin.delete("/items/{slug}")
async def admin_delete_item(slug: str) -> dict[str, Any]:
    in_cases = await _cases_using_count(slug)
    if in_cases > 0:
        raise HTTPException(status_code=409, detail=f"item used in {in_cases} case(s); remove from baskets first")
    res = await items_col.delete_one({"slug": slug})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="item not found")
    return {"ok": True, "slug": slug}


@admin.post("/items/upload-image")
async def admin_upload_image(
    slug: str = Form(..., min_length=2, max_length=64),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="must be an image")
    raw = await file.read()
    if not raw or len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="empty or >10MB image")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
        if max(img.size) > 512:
            scale = 512 / max(img.size)
            img = img.resize((int(img.size[0] * scale), int(img.size[1] * scale)), Image.LANCZOS)
        side = max(img.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2), img)
        out_path = STATIC_DIR / "items" / f"{slug}.png"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out_path, format="PNG", optimize=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"image processing failed: {e}")
    image_path = f"items/{slug}.png"
    return {
        "ok": True, "slug": slug, "image_path": image_path,
        "image_url": static_url(image_path),
        "size_bytes": out_path.stat().st_size,
    }


@admin.post("/items/{slug}/refetch-from-fragment")
async def admin_refetch_fragment(slug: str) -> dict[str, Any]:
    item = await items_col.find_one({"slug": slug}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="item not found")
    frag = _fragment_slug(slug)
    url = f"https://fragment.com/file/gifts/{frag}/thumb.webp"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 LydomaniaAdmin/1.0"})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"fragment fetch error: {e}")
    if r.status_code != 200 or not r.content:
        raise HTTPException(status_code=502, detail=f"fragment returned {r.status_code}")
    try:
        img = Image.open(io.BytesIO(r.content)).convert("RGBA")
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
        if max(img.size) > 512:
            scale = 512 / max(img.size)
            img = img.resize((int(img.size[0] * scale), int(img.size[1] * scale)), Image.LANCZOS)
        side = max(img.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2), img)
        out_path = STATIC_DIR / "items" / f"{slug}.png"
        canvas.save(out_path, format="PNG", optimize=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"convert failed: {e}")
    return {
        "ok": True, "slug": slug, "fragment_slug": frag,
        "image_path": f"items/{slug}.png",
        "image_url": static_url(f"items/{slug}.png"),
        "size_bytes": out_path.stat().st_size,
    }
