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


@admin.get("/users/search")
async def search_users(q: str, limit: int = 12) -> dict:
    """Find users by telegram_id (exact) or username (prefix, case-insensitive)."""
    q = (q or "").strip().lstrip("@")
    if not q:
        return {"rows": []}
    clauses: list[dict] = []
    if q.isdigit():
        clauses.append({"telegram_id": int(q)})
    clauses.append({"username": {"$regex": f"^{_re_escape(q)}", "$options": "i"}})
    cur = users_col.find(
        {"$or": clauses},
        {"_id": 0, "id": 1, "telegram_id": 1, "username": 1, "first_name": 1,
         "balance_ton": 1, "photo_url": 1},
    ).limit(max(1, min(int(limit), 50)))
    return {"rows": [d async for d in cur]}


async def _section(col, match: dict, sort_field: str, amount_fields: list[str],
                   limit: int = 15) -> dict:
    """Generic per-collection rollup: count + summed amounts + most-recent rows."""
    count = await col.count_documents(match)
    totals: dict[str, float] = {}
    if count:
        group = {f"sum_{f}": {"$sum": f"${f}"} for f in amount_fields}
        agg = await col.aggregate([{"$match": match}, {"$group": {"_id": None, **group}}]).to_list(1)
        if agg:
            totals = {f: round(float(agg[0].get(f"sum_{f}") or 0), 4) for f in amount_fields}
    cur = col.find(match, {"_id": 0}).sort(sort_field, -1).limit(limit)
    rows = [d async for d in cur]
    return {"count": count, "totals": totals, "recent": rows}


def _re_escape(s: str) -> str:
    import re
    return re.escape(s)


@admin.get("/users/{telegram_id}/overview")
async def user_overview(telegram_id: int = Path(..., gt=0)) -> dict:
    """Everything-about-a-player view for admins + read-only support staff:
    profile, money trail, inventory, gift deposits, game activity, referrals."""
    u = await users_col.find_one({"telegram_id": int(telegram_id)}, {"_id": 0})
    if not u:
        return {"found": False, "telegram_id": int(telegram_id)}
    uid = u["id"]

    # ── profile ──────────────────────────────────────────────────────────
    referred_by = None
    if u.get("referred_by_user_id"):
        rb = await users_col.find_one(
            {"id": u["referred_by_user_id"]},
            {"_id": 0, "telegram_id": 1, "username": 1, "first_name": 1})
        referred_by = rb
    invited_count = await users_col.count_documents({"referred_by_user_id": uid})
    season = await db["user_season_progress"].find_one(
        {"user_id": uid}, {"_id": 0}, sort=[("updated_at", -1)])

    profile = {
        "id": uid, "telegram_id": u["telegram_id"], "username": u.get("username"),
        "first_name": u.get("first_name"), "last_name": u.get("last_name"),
        "photo_url": u.get("photo_url"), "language_code": u.get("language_code"),
        "created_at": u.get("created_at"), "last_seen": u.get("last_seen"),
        "vip_tier": u.get("vip_tier"), "ref_code": u.get("ref_code"),
    }

    # ── money ────────────────────────────────────────────────────────────
    deposits = await _section(db["deposits"], {"user_id": uid}, "created_at", ["amount_ton"])
    withdrawals = await _section(db["withdrawal_requests"], {"user_id": uid}, "requested_at", ["payout_ton"])
    credits = await _section(db["manual_credits"], {"user_id": uid}, "created_at", ["amount_ton"])
    money = {
        "balance_ton": round(float(u.get("balance_ton") or 0), 4),
        "lifetime_wagered_ton": round(float(u.get("lifetime_wagered_ton") or 0), 4),
        "referral_balance": round(float(u.get("referral_balance") or 0), 4),
        "deposits": deposits, "withdrawals": withdrawals, "manual_credits": credits,
    }

    # ── inventory + gift deposits ───────────────────────────────────────
    inv_count = await db["inventory_items"].count_documents({"user_id": uid})
    inv_held = await db["inventory_items"].count_documents({"user_id": uid, "status": "in_inventory"})
    inv_value_agg = await db["inventory_items"].aggregate([
        {"$match": {"user_id": uid, "status": "in_inventory"}},
        {"$group": {"_id": None, "v": {"$sum": "$payout_ton"}}}]).to_list(1)
    inv_recent = [d async for d in db["inventory_items"].find(
        {"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(20)]
    gift_deposits = await _section(db["gift_deposit_intents"], {"user_id": uid}, "created_at", [])
    inventory = {
        "count": inv_count, "held": inv_held,
        "held_value_ton": round(float(inv_value_agg[0]["v"]) if inv_value_agg else 0, 4),
        "recent": inv_recent, "gift_deposits": gift_deposits,
    }

    # ── game activity ───────────────────────────────────────────────────
    games = {
        "case_opens": await _section(db["rolls"], {"user_id": uid}, "created_at", ["case_price_ton", "payout_ton"]),
        "crash": await _section(db["crash_bets"], {"user_id": uid}, "placed_at", ["amount_ton", "payout_ton"]),
        "mines": await _section(db["mines_games"], {"user_id": uid}, "created_at", ["bet_ton", "payout_ton"]),
        "wheel": await _section(db["wheel_spins"], {"user_id": uid}, "spun_at", ["cost_ton", "payout_ton"]),
        "plinko": await _section(db["plinko_bets"], {"user_id": uid}, "created_at", ["bet_ton", "payout_ton"]),
        "battles": await _section(db["battles"], {"seats.user_id": uid}, "created_at", ["entry_ton"]),
    }

    referrals = {
        "referred_by": referred_by, "invited_count": invited_count,
        "season": season,
    }

    return {
        "found": True, "profile": profile, "money": money,
        "inventory": inventory, "games": games, "referrals": referrals,
    }
