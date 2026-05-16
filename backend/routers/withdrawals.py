"""Withdrawal routes: /inventory/{id}/withdraw (entry), /withdrawals/me, /withdrawals/{wid}/cancel."""
from __future__ import annotations

import secrets
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from tonsdk.utils import Address
from tonsdk.utils._exceptions import InvalidAddressError

from core.auth import get_current_user
from core.db import inventory_col, withdrawals_col
from core.models import WithdrawalOut, WithdrawRequestIn
from core.time_utils import iso, now
from core.ton import static_url
from services.notifications import enqueue_notification

router = APIRouter(prefix="/api")


def validate_ton_address(addr: str) -> str:
    """Validate TON user-friendly address (length + checksum) via tonsdk.

    Returns the trimmed address on success; raises ValueError otherwise.
    """
    a = (addr or "").strip()
    if not a:
        raise ValueError("address is empty")
    try:
        Address(a)
    except InvalidAddressError as e:
        raise ValueError(f"invalid TON address — {e}")
    return a


def withdrawal_doc_to_out(d: dict) -> WithdrawalOut:
    return WithdrawalOut(
        id=d["id"], inventory_id=d["inventory_id"],
        item_slug=d["item_slug"], item_name=d["item_name"],
        item_rarity=d.get("item_rarity") or d.get("rarity", "common"),
        item_image_url=static_url(d.get("item_image_path") or f"items/crate_{d.get('item_rarity','common')}.png"),
        case_id=d.get("case_id"),
        payout_ton=float(d.get("payout_ton", 0.0)),
        destination_address=d.get("destination_address", ""),
        status=d.get("status", "pending"),
        admin_notes=d.get("admin_notes"),
        rejection_reason=d.get("rejection_reason"),
        fulfillment_tx_hash=d.get("fulfillment_tx_hash"),
        fulfillment_value_ton=(float(d["fulfillment_value_ton"]) if d.get("fulfillment_value_ton") is not None else None),
        gift_source=d.get("gift_source"),
        purchased_variant_info=d.get("purchased_variant_info"),
        requested_at=d.get("requested_at") or d.get("created_at", ""),
        processing_at=d.get("processing_at"),
        fulfilled_at=d.get("fulfilled_at"),
        rejected_at=d.get("rejected_at"),
        cancelled_at=d.get("cancelled_at"),
    )


@router.post("/inventory/{inv_id}/withdraw")
async def withdraw_inventory(
    inv_id: str,
    payload: WithdrawRequestIn = Body(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        addr = validate_ton_address(payload.destination_address or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    item = await inventory_col.find_one_and_update(
        {"id": inv_id, "user_id": user["id"], "status": "in_inventory"},
        {"$set": {"status": "withdraw_pending", "withdraw_requested_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    if not item:
        raise HTTPException(status_code=409, detail="item not withdrawable (not yours / wrong status)")
    req_id = secrets.token_hex(12)
    now_iso = iso(now())
    await withdrawals_col.insert_one({
        "id": req_id, "user_id": user["id"], "telegram_id": user["telegram_id"],
        "inventory_id": inv_id, "item_slug": item["item_slug"], "item_name": item["item_name"],
        "item_image_path": item.get("image_path"), "item_rarity": item["rarity"],
        "case_id": item.get("case_id"), "payout_ton": float(item["payout_ton"]),
        "destination_address": addr, "status": "pending",
        "admin_notes": None, "rejection_reason": None,
        "fulfillment_tx_hash": None, "fulfillment_value_ton": None, "gift_source": None,
        "requested_at": now_iso, "processing_at": None, "fulfilled_at": None,
        "rejected_at": None, "cancelled_at": None, "admin_user_id": None,
        "created_at": now_iso,
    })
    await enqueue_notification(
        int(user["telegram_id"]),
        (f"📤 <b>Withdrawal queued</b>\nItem: <b>{item['item_name']}</b>\n"
         f"Value: {float(item['payout_ton']):.2f} TON\nTo: <code>{addr[:6]}…{addr[-6:]}</code>\n\n"
         f"We'll deliver the NFT gift within 24 hours."),
        kind="withdraw_queued",
    )
    return {"id": req_id, "status": "pending", "inventory_id": inv_id, "destination_address": addr}


@router.get("/withdrawals/me", response_model=list[WithdrawalOut])
async def my_withdrawals(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
) -> list[WithdrawalOut]:
    q: dict[str, Any] = {"user_id": user["id"]}
    if status and status != "all":
        q["status"] = status
    cur = withdrawals_col.find(q, {"_id": 0}).sort("requested_at", -1).skip(offset).limit(limit)
    return [withdrawal_doc_to_out(d) async for d in cur]


@router.post("/withdrawals/{wid}/cancel", response_model=WithdrawalOut)
async def cancel_withdrawal(wid: str, user: dict = Depends(get_current_user)) -> WithdrawalOut:
    w = await withdrawals_col.find_one_and_update(
        {"id": wid, "user_id": user["id"], "status": "pending"},
        {"$set": {"status": "cancelled", "cancelled_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    if not w:
        raise HTTPException(status_code=409, detail="cannot cancel (not yours / wrong status)")
    await inventory_col.update_one(
        {"id": w["inventory_id"], "user_id": user["id"]},
        {"$set": {"status": "in_inventory"}, "$unset": {"withdraw_requested_at": ""}},
    )
    await enqueue_notification(
        int(user["telegram_id"]),
        f"↩️ Withdrawal cancelled for <b>{w['item_name']}</b>. The item is back in your collection.",
        kind="withdraw_cancelled",
    )
    return withdrawal_doc_to_out(w)
