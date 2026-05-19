"""Phase 6e — Admin queue for high-value sell-back reviews.

When a user sells an inventory item whose floor ≥ `sell_threshold_ton`,
the request is parked in `sell_reviews` with status=pending. An admin
either approves (credits TON, marks inventory sold) or rejects (restores
the item to in_inventory, no balance change).
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel

from core.auth import get_admin_user
from core.config import logger
from core.db import inventory_col, sell_reviews_col, users_col
from core.time_utils import iso, now

router = APIRouter(prefix="/api/admin/sell-reviews", tags=["admin", "sell-reviews"])


class SellReviewRow(BaseModel):
    id: str
    inventory_id: str
    user_id: str
    username: str | None = None
    telegram_id: int | None = None
    item_slug: str
    item_name: str | None = None
    image_path: str | None = None
    floor_ton: float
    status: str
    created_at: str
    decided_at: str | None = None
    decided_by_admin: int | None = None
    decision_note: str | None = None


class SellReviewListOut(BaseModel):
    rows: list[SellReviewRow]
    counts: dict[str, int]


@router.get("", response_model=SellReviewListOut)
async def admin_list_sell_reviews(
    status: str = Query("all", pattern=r"^(all|pending|approved|rejected)$"),
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(get_admin_user),
) -> SellReviewListOut:
    q: dict = {}
    if status != "all":
        q["status"] = status
    rows: list[SellReviewRow] = []
    cur = sell_reviews_col.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    async for d in cur:
        rows.append(SellReviewRow(**d))
    counts: dict[str, int] = {}
    async for c in sell_reviews_col.aggregate(
        [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    ):
        counts[c["_id"]] = int(c["n"])
    return SellReviewListOut(rows=rows, counts=counts)


@router.post("/{review_id}/approve")
async def admin_approve_sell_review(
    review_id: str,
    note: str = Body("", embed=True),
    admin: dict = Depends(get_admin_user),
) -> dict:
    review = await sell_reviews_col.find_one({"id": review_id}, {"_id": 0})
    if not review:
        raise HTTPException(status_code=404, detail="review not found")
    if review["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"review is {review['status']}")

    # Atomic: flip inventory row to sold + credit user.
    inv = await inventory_col.find_one_and_update(
        {"id": review["inventory_id"], "user_id": review["user_id"],
         "status": "pending_admin_review"},
        {"$set": {"status": "sold", "sold_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    if not inv:
        raise HTTPException(status_code=409, detail="inventory row not in pending_admin_review state")

    payout = float(review["floor_ton"])
    upd_user = await users_col.find_one_and_update(
        {"id": review["user_id"]},
        {"$inc": {"balance_ton": payout},
         "$set": {"updated_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )

    await sell_reviews_col.update_one(
        {"id": review_id},
        {"$set": {
            "status": "approved",
            "decided_at": iso(now()),
            "decided_by_admin": int(admin.get("telegram_id") or 0),
            "decision_note": (note or "")[:500],
            "credited_ton": payout,
        }},
    )
    logger.info("sell_review APPROVED id=%s user=%s slug=%s payout=%.2f admin=%s",
                review_id, review["user_id"], review["item_slug"], payout, admin.get("telegram_id"))
    return {
        "ok": True,
        "credited_ton": payout,
        "balance_ton": float(upd_user["balance_ton"]) if upd_user else 0.0,
    }


@router.post("/{review_id}/reject")
async def admin_reject_sell_review(
    review_id: str,
    note: str = Body("", embed=True),
    admin: dict = Depends(get_admin_user),
) -> dict:
    review = await sell_reviews_col.find_one({"id": review_id}, {"_id": 0})
    if not review:
        raise HTTPException(status_code=404, detail="review not found")
    if review["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"review is {review['status']}")

    # Restore the inventory item back to in_inventory
    inv = await inventory_col.find_one_and_update(
        {"id": review["inventory_id"], "user_id": review["user_id"],
         "status": "pending_admin_review"},
        {"$set": {"status": "in_inventory"},
         "$unset": {"sell_requested_at": ""}},
        return_document=True, projection={"_id": 0},
    )
    if not inv:
        raise HTTPException(status_code=409, detail="inventory row not in pending_admin_review state")

    await sell_reviews_col.update_one(
        {"id": review_id},
        {"$set": {
            "status": "rejected",
            "decided_at": iso(now()),
            "decided_by_admin": int(admin.get("telegram_id") or 0),
            "decision_note": (note or "")[:500],
        }},
    )
    logger.info("sell_review REJECTED id=%s user=%s slug=%s admin=%s",
                review_id, review["user_id"], review["item_slug"], admin.get("telegram_id"))
    return {"ok": True, "inventory_status": "in_inventory"}
