"""Admin withdrawals queue endpoints."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from core.auth import get_admin_user
from core.db import inventory_col, users_col, withdrawals_col
from core.models import (
    AdminFulfillIn, AdminRejectIn, AdminWithdrawalOut, AdminWithdrawalStatsOut,
    AdminWithdrawalUser,
)
from core.time_utils import iso, now
from routers.admin import admin
from routers.withdrawals import withdrawal_doc_to_out
from services.notifications import enqueue_t
from services.i18n import bot_text, user_lang_code
from core.db import users_col as _users_col


async def _attach_user(d: dict) -> AdminWithdrawalOut:
    u = await users_col.find_one(
        {"id": d.get("user_id")},
        {"_id": 0, "telegram_id": 1, "username": 1, "first_name": 1},
    ) or {}
    base = withdrawal_doc_to_out(d)
    return AdminWithdrawalOut(
        **base.model_dump(),
        user=AdminWithdrawalUser(
            telegram_id=int(u.get("telegram_id", d.get("telegram_id", 0))),
            username=u.get("username"), first_name=u.get("first_name"),
        ),
    )


@admin.get("/withdrawals", response_model=list[AdminWithdrawalOut])
async def admin_list_withdrawals(
    status: Optional[str] = Query(None),
    sort: str = Query("requested_desc"),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[AdminWithdrawalOut]:
    q: dict[str, Any] = {}
    if status and status not in ("all", ""):
        q["status"] = status
    if search:
        s = search.strip()
        ors: list[dict[str, Any]] = [{"id": s}]
        if s.isdigit():
            ors.append({"telegram_id": int(s)})
        ids = [u["id"] async for u in users_col.find({"username": {"$regex": s, "$options": "i"}}, {"_id": 0, "id": 1})]
        if ids:
            ors.append({"user_id": {"$in": ids}})
        q["$or"] = ors
    if sort == "requested_asc":
        sort_spec = [("requested_at", 1)]
    elif sort == "value_desc":
        sort_spec = [("payout_ton", -1), ("requested_at", -1)]
    else:
        sort_spec = [("requested_at", -1)]
    cur = withdrawals_col.find(q, {"_id": 0}).sort(sort_spec).skip(offset).limit(limit)
    return [await _attach_user(d) async for d in cur]


@admin.get("/withdrawals/{wid}", response_model=AdminWithdrawalOut)
async def admin_get_withdrawal(wid: str) -> AdminWithdrawalOut:
    d = await withdrawals_col.find_one({"id": wid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="withdrawal not found")
    return await _attach_user(d)


@admin.post("/withdrawals/{wid}/start", response_model=AdminWithdrawalOut)
async def admin_start_withdrawal(wid: str, user: dict = Depends(get_admin_user)) -> AdminWithdrawalOut:
    d = await withdrawals_col.find_one_and_update(
        {"id": wid, "status": "pending"},
        {"$set": {"status": "processing", "processing_at": iso(now()), "admin_user_id": user["id"]}},
        return_document=True, projection={"_id": 0},
    )
    if not d:
        raise HTTPException(status_code=409, detail="withdrawal not in 'pending' state")
    await inventory_col.update_one({"id": d["inventory_id"]}, {"$set": {"status": "withdraw_processing"}})
    await enqueue_t(
        int(d["telegram_id"]),
        "withdraw_processing",
        kind="withdraw_processing",
        item=d["item_name"],
    )
    return await _attach_user(d)


@admin.post("/withdrawals/{wid}/fulfill", response_model=AdminWithdrawalOut)
async def admin_fulfill_withdrawal(wid: str, payload: AdminFulfillIn, user: dict = Depends(get_admin_user)) -> AdminWithdrawalOut:
    d = await withdrawals_col.find_one_and_update(
        {"id": wid, "status": {"$in": ["pending", "processing"]}},
        {"$set": {
            "status": "fulfilled", "fulfilled_at": iso(now()),
            "fulfillment_tx_hash": payload.tx_hash.strip(),
            "fulfillment_value_ton": payload.fulfillment_value_ton,
            "gift_source": payload.gift_source,
            "purchased_variant_info": payload.purchased_variant_info,
            "admin_notes": payload.admin_notes, "admin_user_id": user["id"],
        }},
        return_document=True, projection={"_id": 0},
    )
    if not d:
        raise HTTPException(status_code=409, detail="withdrawal not in 'pending'/'processing'")
    await inventory_col.update_one({"id": d["inventory_id"]}, {"$set": {"status": "withdrawn"}})
    tx_url = f"https://tonviewer.com/transaction/{payload.tx_hash.strip()}"
    # Pre-render the localized "Variant: …" line for this user's language.
    target = await _users_col.find_one(
        {"telegram_id": int(d["telegram_id"])},
        projection={"_id": 0, "language_code": 1},
    )
    lang = user_lang_code(target)
    variant_line = (
        bot_text(lang, "withdraw_fulfilled_variant_line_with", info=payload.purchased_variant_info)
        if payload.purchased_variant_info
        else bot_text(lang, "withdraw_fulfilled_variant_line_floor")
    )
    await enqueue_t(
        int(d["telegram_id"]),
        "withdraw_fulfilled",
        kind="withdraw_fulfilled",
        item=d["item_name"],
        variant_line=variant_line,
        addr_short=f"{d['destination_address'][:6]}…{d['destination_address'][-6:]}",
        tx_url=tx_url,
    )
    return await _attach_user(d)


@admin.post("/withdrawals/{wid}/reject", response_model=AdminWithdrawalOut)
async def admin_reject_withdrawal(wid: str, payload: AdminRejectIn, user: dict = Depends(get_admin_user)) -> AdminWithdrawalOut:
    d = await withdrawals_col.find_one_and_update(
        {"id": wid, "status": {"$in": ["pending", "processing"]}},
        {"$set": {
            "status": "rejected", "rejected_at": iso(now()),
            "rejection_reason": payload.rejection_reason.strip(),
            "admin_user_id": user["id"],
        }},
        return_document=True, projection={"_id": 0},
    )
    if not d:
        raise HTTPException(status_code=409, detail="withdrawal not in 'pending'/'processing'")
    await inventory_col.update_one(
        {"id": d["inventory_id"]},
        {"$set": {"status": "in_inventory"}, "$unset": {"withdraw_requested_at": ""}},
    )
    await enqueue_t(
        int(d["telegram_id"]),
        "withdraw_rejected",
        kind="withdraw_rejected",
        item=d["item_name"],
        reason=payload.rejection_reason.strip(),
    )
    return await _attach_user(d)


@admin.get("/stats/withdrawals", response_model=AdminWithdrawalStatsOut)
async def admin_stats_withdrawals() -> AdminWithdrawalStatsOut:
    counts: dict[str, int] = {}
    async for d in withdrawals_col.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        counts[d["_id"]] = int(d["n"])
    v_doc = await withdrawals_col.aggregate([
        {"$match": {"status": {"$in": ["pending", "processing"]}}},
        {"$group": {"_id": None, "v": {"$sum": "$payout_ton"}}},
    ]).to_list(1)
    pending_value = float(v_doc[0]["v"]) if v_doc else 0.0
    avg_doc = await withdrawals_col.aggregate([
        {"$match": {"status": "fulfilled", "fulfilled_at": {"$ne": None}}},
        {"$project": {"diff": {"$dateDiff": {"startDate": {"$toDate": "$requested_at"}, "endDate": {"$toDate": "$fulfilled_at"}, "unit": "second"}}}},
        {"$group": {"_id": None, "avg": {"$avg": "$diff"}}},
    ]).to_list(1)
    avg_secs = float(avg_doc[0]["avg"]) if avg_doc and avg_doc[0].get("avg") is not None else None
    return AdminWithdrawalStatsOut(
        pending_count=int(counts.get("pending", 0)),
        processing_count=int(counts.get("processing", 0)),
        fulfilled_count=int(counts.get("fulfilled", 0)),
        rejected_count=int(counts.get("rejected", 0)),
        cancelled_count=int(counts.get("cancelled", 0)),
        total_value_pending_ton=round(pending_value, 9),
        avg_fulfillment_seconds=avg_secs,
    )
