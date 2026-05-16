"""Referral routes: /referrals/me, /referrals/claim."""
from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core.auth import gen_ref_code, get_current_user
from core.config import MINI_APP_URL, TELEGRAM_BOT_USERNAME
from core.db import ref_claims_col, ref_credits_col, users_col
from core.models import ReferralClaimOut, ReferralReferred, ReferralStatsOut
from core.time_utils import iso, now
from services.referral_ladder import tier_for_count

router = APIRouter(prefix="/api")


def _mask(u: Optional[str]) -> str:
    if not u:
        return "anon"
    u = u.lstrip("@")
    if len(u) <= 2:
        return u[0] + "*"
    return u[:2] + "*" * (len(u) - 2)


@router.get("/referrals/me", response_model=ReferralStatsOut)
async def referrals_me(user: dict = Depends(get_current_user)) -> ReferralStatsOut:
    fresh = await users_col.find_one({"id": user["id"]}, {"_id": 0})
    ref_code = fresh.get("ref_code") or gen_ref_code()
    if not fresh.get("ref_code"):
        await users_col.update_one({"id": fresh["id"]}, {"$set": {"ref_code": ref_code}})
    bot_user = TELEGRAM_BOT_USERNAME.lstrip("@") or "lydomania777_bot"
    ref_link = f"https://t.me/{bot_user}?start=ref_{ref_code}"
    referral_balance = float(fresh.get("referral_balance", 0.0))
    e_doc = await ref_credits_col.aggregate([
        {"$match": {"referrer_user_id": fresh["id"]}},
        {"$group": {"_id": None, "earnings": {"$sum": "$amount_ton"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    total_earnings = float(e_doc[0]["earnings"]) if e_doc else 0.0
    total_referrals_count = await users_col.count_documents({"referred_by_user_id": fresh["id"]})
    tier, pct, next_tier, next_thr = await tier_for_count(total_referrals_count)
    rec: list[ReferralReferred] = []
    async for r in ref_credits_col.aggregate([
        {"$match": {"referrer_user_id": fresh["id"]}},
        {"$group": {
            "_id": "$referee_user_id",
            "total_wagered": {"$sum": "$wagered_ton"},
            "total_earned": {"$sum": "$amount_ton"},
            "last_at": {"$max": "$created_at"},
        }},
        {"$sort": {"last_at": -1}},
        {"$limit": 20},
    ]):
        referee = await users_col.find_one({"id": r["_id"]}, {"_id": 0, "username": 1, "first_name": 1})
        username = referee.get("username") if referee else None
        display = username or (referee.get("first_name") if referee else None) or "anon"
        rec.append(ReferralReferred(
            username=username, masked_username=_mask(display),
            total_wagered_ton=float(r["total_wagered"]),
            your_earnings_ton=float(r["total_earned"]),
        ))
    return ReferralStatsOut(
        ref_code=ref_code, ref_link=ref_link, referral_pct=pct / 100.0,
        current_tier=tier, current_pct=pct,
        next_tier=next_tier, next_tier_threshold=next_thr,
        referees_until_next_tier=(max(0, next_thr - total_referrals_count) if next_thr is not None else None),
        total_referrals_count=total_referrals_count,
        total_earnings_ton=round(total_earnings, 9),
        claimable_ton=round(referral_balance, 9),
        recent_referrals=rec,
    )


@router.post("/referrals/claim", response_model=ReferralClaimOut)
async def referrals_claim(user: dict = Depends(get_current_user)) -> ReferralClaimOut:
    fresh = await users_col.find_one_and_update(
        {"id": user["id"], "referral_balance": {"$gt": 0}},
        [{"$set": {
            "balance_ton": {"$add": ["$balance_ton", "$referral_balance"]},
            "referral_balance": 0.0,
            "updated_at": iso(now()),
        }}],
        return_document=True, projection={"_id": 0},
    )
    if not fresh:
        raise HTTPException(status_code=400, detail="nothing to claim")
    claimed = float(user.get("referral_balance", 0.0))
    if claimed <= 0:
        e_doc = await ref_credits_col.aggregate([
            {"$match": {"referrer_user_id": fresh["id"]}},
            {"$group": {"_id": None, "e": {"$sum": "$amount_ton"}}},
        ]).to_list(1)
        c_doc = await ref_claims_col.aggregate([
            {"$match": {"user_id": fresh["id"]}},
            {"$group": {"_id": None, "c": {"$sum": "$amount_ton"}}},
        ]).to_list(1)
        claimed = max(0.0, float(e_doc[0]["e"] if e_doc else 0.0) - float(c_doc[0]["c"] if c_doc else 0.0))
    await ref_claims_col.insert_one({
        "id": secrets.token_hex(12), "user_id": fresh["id"],
        "amount_ton": claimed, "created_at": iso(now()),
    })
    return ReferralClaimOut(
        claimed_ton=round(claimed, 9),
        new_main_balance=float(fresh["balance_ton"]),
        new_referral_balance=float(fresh.get("referral_balance", 0.0)),
    )
