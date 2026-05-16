"""Phase 4b — Admin CRUD for promo codes."""
from __future__ import annotations

import secrets
from typing import Any

from fastapi import Body, Depends, HTTPException, Query

from core.auth import get_admin_user
from core.db import promo_codes_col, promo_redemptions_col
from core.models import PromoCodeIn, PromoCodeOut, PromoCodePatchIn
from core.time_utils import iso, now
from routers.admin import admin


def _doc_to_out(d: dict[str, Any]) -> PromoCodeOut:
    return PromoCodeOut(
        id=d["id"],
        code=d["code"],
        type=d["type"],
        value=float(d["value"]) if d["type"] == "ton_bonus" else int(d["value"]),
        max_redemptions=int(d.get("max_redemptions") or 0),
        current_redemptions=int(d.get("current_redemptions") or 0),
        user_max=int(d.get("user_max") or 1),
        expires_at=d.get("expires_at"),
        enabled=bool(d.get("enabled", True)),
        notes=d.get("notes"),
        created_by_admin=int(d.get("created_by_admin") or 0),
        created_at=d.get("created_at"),
        updated_at=d.get("updated_at"),
    )


@admin.post("/promos", response_model=PromoCodeOut)
async def admin_create_promo(payload: PromoCodeIn, admin_user: dict = Depends(get_admin_user)) -> PromoCodeOut:
    code = (payload.code or "").upper().strip()
    if not code or len(code) < 3:
        raise HTTPException(status_code=400, detail="code length must be ≥3")
    if await promo_codes_col.find_one({"code": code}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="code already exists")
    if payload.type not in ("ton_bonus", "free_spin_token"):
        raise HTTPException(status_code=400, detail="type must be ton_bonus|free_spin_token")
    value = float(payload.value) if payload.type == "ton_bonus" else int(payload.value)
    if value <= 0:
        raise HTTPException(status_code=400, detail="value must be > 0")
    doc = {
        "id": secrets.token_hex(10),
        "code": code,
        "type": payload.type,
        "value": value,
        "max_redemptions": int(payload.max_redemptions or 0),
        "current_redemptions": 0,
        "user_max": int(payload.user_max or 1),
        "expires_at": payload.expires_at,
        "enabled": bool(payload.enabled),
        "notes": payload.notes,
        "created_by_admin": int(admin_user.get("telegram_id") or 0),
        "created_at": iso(now()),
        "updated_at": iso(now()),
    }
    await promo_codes_col.insert_one(doc)
    return _doc_to_out(doc)


@admin.get("/promos")
async def admin_list_promos(
    include_disabled: bool = Query(True),
    type_: str | None = Query(None, alias="type"),
) -> list[dict[str, Any]]:
    q: dict[str, Any] = {}
    if not include_disabled:
        q["enabled"] = True
    if type_:
        q["type"] = type_
    out = []
    async for d in promo_codes_col.find(q, {"_id": 0}).sort("created_at", -1):
        out.append(_doc_to_out(d).model_dump())
    return out


@admin.get("/promos/{code}")
async def admin_get_promo(code: str) -> dict[str, Any]:
    d = await promo_codes_col.find_one({"code": code.upper().strip()}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="not found")
    out = _doc_to_out(d).model_dump()
    redemptions = []
    async for r in promo_redemptions_col.find({"code": code.upper().strip()}, {"_id": 0}).sort("redeemed_at", -1).limit(50):
        redemptions.append(r)
    out["recent_redemptions"] = redemptions
    return out


@admin.patch("/promos/{code}", response_model=PromoCodeOut)
async def admin_patch_promo(code: str, payload: PromoCodePatchIn) -> PromoCodeOut:
    patch = payload.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="empty patch")
    if "value" in patch and patch["value"] is not None and float(patch["value"]) <= 0:
        raise HTTPException(status_code=400, detail="value must be > 0")
    patch["updated_at"] = iso(now())
    upd = await promo_codes_col.find_one_and_update(
        {"code": code.upper().strip()}, {"$set": patch},
        return_document=True, projection={"_id": 0},
    )
    if not upd:
        raise HTTPException(status_code=404, detail="not found")
    return _doc_to_out(upd)


@admin.delete("/promos/{code}")
async def admin_delete_promo(code: str) -> dict[str, Any]:
    upd = await promo_codes_col.find_one_and_update(
        {"code": code.upper().strip()},
        {"$set": {"enabled": False, "updated_at": iso(now())}},
        return_document=True, projection={"_id": 0, "code": 1, "enabled": 1},
    )
    if not upd:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True, "code": upd["code"], "enabled": upd["enabled"]}
