"""Inventory routes: GET /inventory, POST /inventory/{id}/sell."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import get_current_user
from core.db import cases_col, inventory_col, users_col
from core.models import (
    BalanceOut, InventoryItemOut, InventoryPageOut, InventoryTotalsOut,
)
from core.time_utils import iso, now
from core.ton import static_url

router = APIRouter(prefix="/api")


@router.get("/inventory", response_model=InventoryPageOut)
async def list_inventory(
    status: Optional[str] = Query(None),
    rarity: Optional[str] = Query(None),
    case_id: Optional[str] = Query(None),
    sort: str = Query("date_desc"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
) -> InventoryPageOut:
    q: dict[str, Any] = {"user_id": user["id"]}
    if status and status != "all":
        q["status"] = status
    if rarity and rarity != "all":
        q["rarity"] = rarity
    if case_id and case_id != "all":
        q["case_id"] = case_id
    pipeline_totals = [
        {"$match": {"user_id": user["id"]}},
        {"$group": {
            "_id": None,
            "total_count": {"$sum": 1},
            "total_value_unsold_ton": {"$sum": {"$cond": [{"$eq": ["$status", "in_inventory"]}, "$payout_ton", 0]}},
            "total_value_all_time_ton": {"$sum": "$payout_ton"},
        }},
    ]
    tot_doc = await inventory_col.aggregate(pipeline_totals).to_list(1)
    totals_base = tot_doc[0] if tot_doc else {"total_count": 0, "total_value_unsold_ton": 0.0, "total_value_all_time_ton": 0.0}
    count_by_rarity: dict[str, int] = {}
    count_by_status: dict[str, int] = {}
    async for d in inventory_col.aggregate([{"$match": {"user_id": user["id"]}}, {"$group": {"_id": "$rarity", "n": {"$sum": 1}}}]):
        count_by_rarity[d["_id"]] = int(d["n"])
    async for d in inventory_col.aggregate([{"$match": {"user_id": user["id"]}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        count_by_status[d["_id"]] = int(d["n"])
    totals = InventoryTotalsOut(
        total_count=int(totals_base.get("total_count", 0)),
        total_value_unsold_ton=float(totals_base.get("total_value_unsold_ton", 0)),
        total_value_all_time_ton=float(totals_base.get("total_value_all_time_ton", 0)),
        count_by_rarity=count_by_rarity, count_by_status=count_by_status,
    )
    if sort == "value_desc":
        sort_spec = [("payout_ton", -1), ("created_at", -1)]
    elif sort == "value_asc":
        sort_spec = [("payout_ton", 1), ("created_at", -1)]
    elif sort == "date_asc":
        sort_spec = [("created_at", 1)]
    elif sort == "rarity_desc":
        sort_spec = [("payout_ton", -1)]
    else:
        sort_spec = [("created_at", -1)]
    cur = inventory_col.find(q, {"_id": 0}).sort(sort_spec).skip(offset).limit(limit)
    case_names: dict[str, str] = {}
    async for c in cases_col.find({}, {"_id": 0, "id": 1, "name": 1}):
        case_names[c["id"]] = c["name"]
    out: list[InventoryItemOut] = []
    async for d in cur:
        out.append(InventoryItemOut(
            id=d["id"], item_slug=d["item_slug"], item_name=d["item_name"],
            rarity=d["rarity"], image_url=static_url(d.get("image_path", "items/crate_common.png")),
            payout_ton=float(d["payout_ton"]), status=d["status"], case_id=d["case_id"],
            case_name=case_names.get(d["case_id"]),
            roll_id=d["roll_id"], created_at=d["created_at"],
        ))
    return InventoryPageOut(items=out, totals=totals)


@router.post("/inventory/{inv_id}/sell", response_model=BalanceOut)
async def sell_inventory(inv_id: str, user: dict = Depends(get_current_user)) -> BalanceOut:
    item = await inventory_col.find_one_and_update(
        {"id": inv_id, "user_id": user["id"], "status": "in_inventory"},
        {"$set": {"status": "sold", "sold_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    if not item:
        raise HTTPException(status_code=409, detail="item not sellable (not yours / wrong status)")
    payout = float(item["payout_ton"])
    updated = await users_col.find_one_and_update(
        {"id": user["id"]},
        {"$inc": {"balance_ton": payout}, "$set": {"updated_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    return BalanceOut(balance_ton=float(updated["balance_ton"]))
