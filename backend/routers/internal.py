"""Bot internal API: /internal/* (gated by X-Internal-Secret)."""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from core.auth import upsert_user_from_tg
from core.config import (
    DEPOSIT_INTENT_TTL_S, INTERNAL_API_SECRET, MINI_APP_URL, TON_NETWORK, logger,
)
from core.db import (
    cases_col, intents_col, notifications_col, pending_refs_col, users_col,
)
from core.models import (
    InternalBalanceOut, InternalCaseTile, InternalDepositIntentOut,
    InternalRefTagIn, NotifAckIn,
)
from core.time_utils import iso, now
from core.ton import VAULT_ADDR_NB

router = APIRouter(prefix="/api/internal")


async def verify_internal_secret(x_internal_secret: Optional[str] = Header(None)) -> None:
    if not INTERNAL_API_SECRET or x_internal_secret != INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="invalid internal secret")


@router.get("/user/{telegram_id}/balance", response_model=InternalBalanceOut, dependencies=[Depends(verify_internal_secret)])
async def internal_user_balance(telegram_id: int) -> InternalBalanceOut:
    u = await users_col.find_one({"telegram_id": telegram_id}, {"_id": 0})
    if not u:
        return InternalBalanceOut(exists=False)
    return InternalBalanceOut(
        exists=True, user_id=u["id"], username=u.get("username"),
        balance_ton=float(u.get("balance_ton", 0.0)),
        referral_balance_ton=float(u.get("referral_balance", 0.0)),
    )


@router.post("/user/{telegram_id}/deposit-intent", response_model=InternalDepositIntentOut, dependencies=[Depends(verify_internal_secret)])
async def internal_deposit_intent(telegram_id: int) -> InternalDepositIntentOut:
    user = await upsert_user_from_tg(telegram_id=telegram_id)
    nonce = secrets.token_hex(4)
    memo = f"dep:{user['id']}:{nonce}"
    expires = now() + timedelta(seconds=DEPOSIT_INTENT_TTL_S)
    await intents_col.insert_one({
        "id": secrets.token_hex(12), "user_id": user["id"], "telegram_id": telegram_id,
        "nonce": nonce, "memo": memo, "status": "pending",
        "created_at": iso(now()), "expires_at": iso(expires),
    })
    return InternalDepositIntentOut(address=VAULT_ADDR_NB, memo=memo, network=TON_NETWORK)


@router.get("/cases", response_model=list[InternalCaseTile], dependencies=[Depends(verify_internal_secret)])
async def internal_cases() -> list[InternalCaseTile]:
    out: list[InternalCaseTile] = []
    async for c in cases_col.find({"enabled": True}, {"_id": 0, "id": 1, "name": 1, "price_ton": 1}).sort("price_ton", 1):
        out.append(InternalCaseTile(id=c["id"], name=c["name"], price_ton=float(c["price_ton"])))
    return out


@router.get("/mini-app-url", dependencies=[Depends(verify_internal_secret)])
async def internal_mini_app_url() -> dict:
    return {"url": MINI_APP_URL}


@router.post("/referrals/tag", dependencies=[Depends(verify_internal_secret)])
async def internal_referrals_tag(payload: InternalRefTagIn) -> dict[str, Any]:
    # Phase 3a: self-referral block + per-day cap honored via settings
    from services.settings import get_settings
    settings = await get_settings()
    referrer = await users_col.find_one({"ref_code": payload.ref_code.strip().upper()}, {"_id": 0})
    if not referrer:
        return {"ok": False, "reason": "ref_code not found"}
    # Self-referral
    if settings.get("self_referral_blocked", True) and int(referrer.get("telegram_id", 0)) == int(payload.telegram_id):
        from core.db import referral_abuse_col
        await referral_abuse_col.insert_one({
            "id": secrets.token_hex(12), "kind": "self_referral",
            "telegram_id": payload.telegram_id, "referrer_id": referrer["id"],
            "ref_code": payload.ref_code, "created_at": iso(now()),
        })
        return {"ok": False, "reason": "self-referral blocked"}
    # Daily cap
    cap = int(settings.get("max_referrals_per_day_per_user", 20))
    if cap > 0:
        today_start = iso(now().replace(hour=0, minute=0, second=0, microsecond=0))
        today_count = await users_col.count_documents({
            "referred_by_user_id": referrer["id"], "created_at": {"$gte": today_start},
        })
        if today_count >= cap:
            from core.db import referral_abuse_col
            await referral_abuse_col.insert_one({
                "id": secrets.token_hex(12), "kind": "daily_cap",
                "referrer_id": referrer["id"], "telegram_id": payload.telegram_id,
                "ref_code": payload.ref_code, "today_count": today_count, "cap": cap,
                "created_at": iso(now()),
            })
            return {"ok": False, "reason": "daily referrals cap reached"}
    existing = await users_col.find_one({"telegram_id": payload.telegram_id}, {"_id": 0})
    tagged_now = False
    if existing:
        if not existing.get("referred_by_user_id") and existing["id"] != referrer["id"]:
            await users_col.update_one({"id": existing["id"]}, {"$set": {"referred_by_user_id": referrer["id"]}})
            tagged_now = True
    else:
        await pending_refs_col.update_one(
            {"telegram_id": payload.telegram_id},
            {"$set": {
                "telegram_id": payload.telegram_id, "ref_code": payload.ref_code,
                "created_at": iso(now()),
                "expires_at": iso(now() + timedelta(days=30)),
            }},
            upsert=True,
        )
        await pending_refs_col.delete_one({"telegram_id": payload.telegram_id, "_dummy": True})
    return {"ok": True, "tagged_immediately": tagged_now}


@router.get("/notifications/pending", dependencies=[Depends(verify_internal_secret)])
async def internal_notifications_pending(limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for _ in range(limit):
        doc = await notifications_col.find_one_and_update(
            {"status": "queued"},
            {"$set": {"status": "sending", "claimed_at": iso(now())}, "$inc": {"attempts": 1}},
            sort=[("created_at", 1)], return_document=True, projection={"_id": 0},
        )
        if not doc:
            break
        out.append(doc)
    return out


@router.post("/notifications/ack", dependencies=[Depends(verify_internal_secret)])
async def internal_notifications_ack(payload: NotifAckIn) -> dict[str, Any]:
    upd = {"status": "sent" if payload.success else "failed", "completed_at": iso(now())}
    if payload.error and not payload.success:
        upd["last_error"] = payload.error
    await notifications_col.update_one({"id": payload.id}, {"$set": upd})
    return {"ok": True}
