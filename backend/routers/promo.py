"""
Phase 4b — Promo codes.

Admin CRUD lives in routers/admin/promos.py. This module is the user-facing
redemption + listing.

Schema (`promo_codes` collection):
    id, code (uppercased, unique), type ('ton_bonus' | 'free_spin_token'),
    value (float for ton_bonus; int for free_spin_token),
    max_redemptions, current_redemptions, user_max,
    expires_at (iso str or null), enabled (bool),
    created_by_admin (telegram_id), created_at, updated_at, notes.

Per-user redemption is recorded in `promo_redemptions`:
    {user_id, code, type, value, redeemed_at}
"""
from __future__ import annotations

import secrets
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.db import promo_codes_col, promo_redemptions_col, users_col, with_txn
from core.models import PromoRedeemIn, PromoRedeemOut
from core.time_utils import iso, now

router = APIRouter(prefix="/api")


async def _find_code(code: str) -> Optional[dict[str, Any]]:
    return await promo_codes_col.find_one({"code": code.upper().strip()}, {"_id": 0})


@router.post("/promo/redeem", response_model=PromoRedeemOut)
async def redeem_promo(payload: PromoRedeemIn, user: dict = Depends(get_current_user)) -> PromoRedeemOut:
    code = (payload.code or "").upper().strip()
    if not code or len(code) < 3 or len(code) > 32:
        raise HTTPException(status_code=400, detail="invalid code length")
    promo = await _find_code(code)
    if not promo:
        raise HTTPException(status_code=404, detail="code not found")
    if not promo.get("enabled", True):
        raise HTTPException(status_code=400, detail="code disabled")
    if promo.get("expires_at") and iso(now()) > promo["expires_at"]:
        raise HTTPException(status_code=400, detail="code expired")
    max_red = int(promo.get("max_redemptions") or 0)
    cur_red = int(promo.get("current_redemptions") or 0)
    if max_red > 0 and cur_red >= max_red:
        raise HTTPException(status_code=400, detail="code fully redeemed")
    user_max = int(promo.get("user_max") or 1)
    user_redemptions = await promo_redemptions_col.count_documents({
        "user_id": user["id"], "code": code,
    })
    if user_redemptions >= user_max:
        raise HTTPException(status_code=400, detail="already redeemed this code")

    kind = promo.get("type")
    value = promo.get("value")
    if kind == "ton_bonus":
        amount = float(value or 0)
        if amount <= 0:
            raise HTTPException(status_code=500, detail="malformed code (ton_bonus value <=0)")
    elif kind == "free_spin_token":
        tokens = int(value or 1)
        if tokens <= 0:
            raise HTTPException(status_code=500, detail="malformed code (free_spin_token value <=0)")
    else:
        raise HTTPException(status_code=500, detail=f"unknown promo type: {kind}")

    # One transaction: re-check the per-user limit, apply the credit, record the
    # redemption, and bump the code counter together — so a code is never credited
    # without its redemption being recorded (or vice-versa).
    async def _txn(session):
        seen = await promo_redemptions_col.count_documents(
            {"user_id": user["id"], "code": code}, session=session,
        )
        if seen >= user_max:
            raise HTTPException(status_code=400, detail="already redeemed this code")
        if kind == "ton_bonus":
            u = await users_col.find_one_and_update(
                {"id": user["id"]}, {"$inc": {"balance_ton": amount}},
                return_document=True, projection={"_id": 0, "balance_ton": 1}, session=session,
            )
            out = {"type": "ton_bonus", "credited_ton": amount,
                   "new_balance_ton": float((u or {}).get("balance_ton") or 0)}
        else:
            u = await users_col.find_one_and_update(
                {"id": user["id"]}, {"$inc": {"free_spin_tokens": tokens}},
                return_document=True, projection={"_id": 0, "free_spin_tokens": 1}, session=session,
            )
            out = {"type": "free_spin_token", "tokens_added": tokens,
                   "free_spin_tokens": int((u or {}).get("free_spin_tokens") or 0)}
        await promo_redemptions_col.insert_one({
            "id": secrets.token_hex(12),
            "user_id": user["id"], "code": code,
            "type": kind, "value": value, "redeemed_at": iso(now()),
        }, session=session)
        await promo_codes_col.update_one(
            {"code": code}, {"$inc": {"current_redemptions": 1}}, session=session,
        )
        return out

    applied = await with_txn(_txn)
    return PromoRedeemOut(code=code, applied=applied)
