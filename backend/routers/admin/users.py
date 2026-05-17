"""
Phase 6a hotfix — admin endpoints for manual balance credits + user lookup.

POST  /api/admin/users/{telegram_id}/credit  — credit a user, audit-logged
GET   /api/admin/users/{telegram_id}/credits — list recent credits
GET   /api/admin/users/lookup?telegram_id=…  — preview user before crediting

Auth: admin only (Depends(get_admin_user) on the parent router).
Audit: every credit is logged to `manual_credits` collection.
"""

from __future__ import annotations

import secrets
from typing import Optional

from fastapi import Body, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from core.auth import get_admin_user
from core.db import db, users_col
from core.time_utils import iso, now
from routers.admin import admin


manual_credits_col = db["manual_credits"]


class ManualCreditIn(BaseModel):
    amount_ton: float = Field(..., gt=0, le=1_000_000)
    reason: Optional[str] = Field(default="manual_credit", max_length=200)


class ManualCreditOut(BaseModel):
    telegram_id: int
    user_id: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    amount_ton: float
    balance_before: float
    balance_after: float
    reason: str
    admin_telegram_id: int


@admin.post("/users/{telegram_id}/credit", response_model=ManualCreditOut)
async def credit_user(
    telegram_id: int = Path(..., gt=0),
    payload: ManualCreditIn = Body(...),
    admin_user: dict = Depends(get_admin_user),
) -> ManualCreditOut:
    target = await users_col.find_one({"telegram_id": int(telegram_id)}, {"_id": 0})
    if not target:
        raise HTTPException(
            status_code=404,
            detail=f"user not found (telegram_id={telegram_id}) — must /start the bot first",
        )

    before = float(target.get("balance_ton") or 0.0)
    updated = await users_col.find_one_and_update(
        {"telegram_id": int(telegram_id)},
        {"$inc": {"balance_ton": float(payload.amount_ton)},
         "$set": {"updated_at": iso(now())}},
        return_document=True,
        projection={"_id": 0, "id": 1, "telegram_id": 1, "username": 1,
                    "first_name": 1, "balance_ton": 1},
    )
    after = float(updated["balance_ton"])
    reason = (payload.reason or "manual_credit").strip()[:200]

    await manual_credits_col.insert_one({
        "id": secrets.token_hex(12),
        "telegram_id": int(telegram_id),
        "user_id": updated["id"],
        "amount_ton": float(payload.amount_ton),
        "balance_before": before,
        "balance_after": after,
        "reason": reason,
        "admin": str(admin_user.get("telegram_id") or admin_user.get("id") or "admin"),
        "admin_telegram_id": int(admin_user.get("telegram_id") or 0),
        "source": "api",
        "created_at": iso(now()),
    })

    return ManualCreditOut(
        telegram_id=int(telegram_id),
        user_id=updated["id"],
        username=updated.get("username"),
        first_name=updated.get("first_name"),
        amount_ton=float(payload.amount_ton),
        balance_before=before,
        balance_after=after,
        reason=reason,
        admin_telegram_id=int(admin_user.get("telegram_id") or 0),
    )


@admin.get("/users/{telegram_id}/credits")
async def list_user_credits(telegram_id: int = Path(..., gt=0)) -> dict:
    """List recent manual credits for a user (audit history)."""
    cur = manual_credits_col.find(
        {"telegram_id": int(telegram_id)},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)
    rows = [doc async for doc in cur]
    total = sum(float(r.get("amount_ton") or 0) for r in rows)
    return {
        "telegram_id": int(telegram_id),
        "count": len(rows),
        "total_credited_ton": total,
        "rows": rows,
    }


@admin.get("/users/lookup")
async def lookup_user(telegram_id: int) -> dict:
    """Lookup a user by telegram_id — handy for the admin UI."""
    doc = await users_col.find_one(
        {"telegram_id": int(telegram_id)},
        {"_id": 0, "id": 1, "telegram_id": 1, "username": 1, "first_name": 1,
         "last_name": 1, "balance_ton": 1, "created_at": 1},
    )
    if not doc:
        return {"found": False, "telegram_id": int(telegram_id)}
    return {"found": True, "user": doc}
