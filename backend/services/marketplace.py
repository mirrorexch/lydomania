"""Phase 9 — P2P Gift Marketplace service.

Listings collection: marketplace_listings
   { listing_id, seller_user_id, inventory_item_id, item_template_slug,
     price_ton, status (active|sold|cancelled|expired),
     created_at, expires_at, sold_at?, buyer_user_id?, fee_ton? }

Inventory items get a `marketplace_status` field flipped to "on_sale" while
listed so they can't be withdrawn or re-listed.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import timedelta
from typing import Any

from pymongo import ASCENDING, DESCENDING, ReturnDocument

from core.db import db, inventory_col, items_col, users_col, with_txn
from core.time_utils import iso, now
from core.ton import static_url

LOG = logging.getLogger("lydomania.marketplace")
listings_col = db["marketplace_listings"]
fees_col     = db["marketplace_fees_collected"]

MIN_PRICE_TON = float(os.environ.get("MARKETPLACE_MIN_TON", "0.1"))
MAX_PRICE_TON = float(os.environ.get("MARKETPLACE_MAX_TON", "10000"))
LISTING_TTL_DAYS = 7
FEE_BPS_DEFAULT = int(os.environ.get("MARKETPLACE_FEE_BPS", "500"))   # 5%


class MarketError(Exception):
    """Surface as 400."""


async def ensure_indexes() -> None:
    await listings_col.create_index("listing_id", unique=True)
    await listings_col.create_index(
        [("status", ASCENDING), ("created_at", DESCENDING)],
    )
    await listings_col.create_index("inventory_item_id")
    await listings_col.create_index("seller_user_id")
    await listings_col.create_index("item_template_slug")


def _fee_for(price_ton: float, vip_fee_discount_bps: int = 0) -> float:
    bps = max(0, FEE_BPS_DEFAULT - int(vip_fee_discount_bps))
    return round(price_ton * (bps / 10_000.0), 6)


async def list_item(
    seller_user_id: str, inventory_item_id: str, price_ton: float,
) -> dict[str, Any]:
    if price_ton < MIN_PRICE_TON or price_ton > MAX_PRICE_TON:
        raise MarketError("price_out_of_range")

    # Validate ownership + not already locked
    inv = await inventory_col.find_one({"id": inventory_item_id}, {"_id": 0})
    if not inv:
        raise MarketError("item_not_found")
    if inv.get("user_id") != seller_user_id:
        raise MarketError("not_owner")
    if inv.get("status") != "in_inventory":
        raise MarketError("item_locked")
    if inv.get("marketplace_status") == "on_sale":
        raise MarketError("already_listed")

    # Atomic flip — also stamps listing_id on the inventory doc so /api/inventory
    # can surface it to the frontend without an extra join.
    listing_id = secrets.token_hex(12)
    flipped = await inventory_col.find_one_and_update(
        {"id": inventory_item_id, "user_id": seller_user_id,
         "status": "in_inventory",
         "marketplace_status": {"$ne": "on_sale"}},
        {"$set": {"marketplace_status": "on_sale",
                  "marketplace_listing_id": listing_id,
                  "updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not flipped:
        raise MarketError("race_lost")

    expires_at = iso(now() + timedelta(days=LISTING_TTL_DAYS))
    doc = {
        "listing_id": listing_id,
        "seller_user_id": seller_user_id,
        "inventory_item_id": inventory_item_id,
        "item_template_slug": flipped.get("item_slug"),
        "item_name": flipped.get("item_name"),
        "image_path": flipped.get("image_path"),
        "rarity": flipped.get("rarity"),
        "floor_ton": float(flipped.get("payout_ton") or 0),
        "price_ton": float(price_ton),
        "status": "active",
        "created_at": iso(now()),
        "expires_at": expires_at,
    }
    await listings_col.insert_one(dict(doc))
    doc.pop("_id", None)

    # Fix-H: embed the inventory_item snapshot so the frontend can patch
    # state immediately after POST /api/marketplace/list, without re-fetching
    # the full inventory page.
    doc["inventory_item"] = {
        "id": flipped["id"],
        "marketplace_status": "on_sale",
        "marketplace_listing_id": listing_id,
    }

    # Achievements / missions hook
    try:
        from services.actions import record_action
        await record_action(seller_user_id, "marketplace_list",
            event_id=f"list:{listing_id}", amount_ton=price_ton)
    except Exception as e:  # noqa: BLE001
        LOG.warning("marketplace: list hook failed: %s", e)

    return doc


async def cancel_listing(seller_user_id: str, listing_id: str) -> dict[str, Any]:
    flipped = await listings_col.find_one_and_update(
        {"listing_id": listing_id, "seller_user_id": seller_user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": iso(now())}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not flipped:
        raise MarketError("not_cancellable")
    # Fix-H: zero BOTH marketplace fields so the Inventory card reverts to
    # the three-button state (Quick Sell + List + Withdraw).
    await inventory_col.update_one(
        {"id": flipped["inventory_item_id"], "user_id": seller_user_id},
        {"$set": {"marketplace_status": "off_sale", "updated_at": iso(now())},
         "$unset": {"marketplace_listing_id": ""}},
    )
    # Embed inventory_item snapshot for frontend patch without reload
    flipped["inventory_item"] = {
        "id": flipped["inventory_item_id"],
        "marketplace_status": "off_sale",
        "marketplace_listing_id": None,
    }
    return flipped


async def buy_listing(buyer_user_id: str, listing_id: str,
                      vip_fee_discount_bps: int = 0) -> dict[str, Any]:
    listing = await listings_col.find_one({"listing_id": listing_id}, {"_id": 0})
    if not listing:
        raise MarketError("listing_not_found")
    if listing.get("status") == "sold":
        raise MarketError("already_sold")
    if listing.get("status") == "cancelled":
        raise MarketError("cancelled")
    if listing.get("status") == "expired":
        raise MarketError("expired")
    if listing.get("status") != "active":
        raise MarketError("not_active")
    if listing["seller_user_id"] == buyer_user_id:
        raise MarketError("cannot_self_buy")

    price = float(listing["price_ton"])
    fee = _fee_for(price, vip_fee_discount_bps)
    seller_credit = round(price - fee, 6)

    # All money movements run in ONE transaction: listing flip, buyer debit,
    # seller credit, item transfer, fee. If any step fails (e.g. insufficient
    # balance), the whole thing rolls back atomically — no half-sold listings,
    # no debit-without-transfer. Concurrent buyers conflict on the status CAS and
    # exactly one wins.
    async def _txn(session):
        flipped = await listings_col.find_one_and_update(
            {"listing_id": listing_id, "status": "active"},
            {"$set": {"status": "sold", "sold_at": iso(now()),
                      "buyer_user_id": buyer_user_id,
                      "fee_ton": fee, "seller_credit_ton": seller_credit}},
            return_document=ReturnDocument.AFTER, projection={"_id": 0}, session=session,
        )
        if not flipped:
            raise MarketError("listing_already_sold")
        debited_doc = await users_col.find_one_and_update(
            {"id": buyer_user_id, "balance_ton": {"$gte": price}},
            {"$inc": {"balance_ton": -price}, "$set": {"updated_at": iso(now())}},
            return_document=ReturnDocument.AFTER, projection={"_id": 0, "balance_ton": 1},
            session=session,
        )
        if not debited_doc:
            # Abort → the listing flip above is rolled back automatically.
            raise MarketError("insufficient_balance")
        await users_col.update_one(
            {"id": listing["seller_user_id"]},
            {"$inc": {"balance_ton": seller_credit}, "$set": {"updated_at": iso(now())}},
            session=session,
        )
        await inventory_col.update_one(
            {"id": listing["inventory_item_id"]},
            {"$set": {"user_id": buyer_user_id, "marketplace_status": "off_sale",
                      "updated_at": iso(now())},
             "$unset": {"marketplace_listing_id": ""}},
            session=session,
        )
        await fees_col.insert_one(
            {"listing_id": listing_id, "fee_ton": fee, "created_at": iso(now())},
            session=session,
        )
        return debited_doc

    debited = await with_txn(_txn)

    # Hooks
    try:
        from services.actions import record_action
        await record_action(buyer_user_id, "marketplace_buy",
            event_id=f"buy:{listing_id}", amount_ton=price)
        await record_action(listing["seller_user_id"], "marketplace_sell",
            event_id=f"sold:{listing_id}", amount_ton=seller_credit, payout_ton=seller_credit)
    except Exception as e:  # noqa: BLE001
        LOG.warning("marketplace: buy hook failed: %s", e)

    return {
        "listing_id": listing_id, "price_ton": price, "fee_ton": fee,
        "seller_credit_ton": seller_credit,
        "new_balance_ton": float(debited.get("balance_ton") or 0),
        "item_name": listing.get("item_name"),
        "item_slug": listing.get("item_template_slug"),
    }


async def browse(*, item_slug: str | None = None,
                 min_price: float | None = None, max_price: float | None = None,
                 sort: str = "recent", page: int = 1, page_size: int = 20) -> dict[str, Any]:
    q: dict[str, Any] = {"status": "active"}
    if item_slug:
        q["item_template_slug"] = item_slug
    if min_price is not None:
        q.setdefault("price_ton", {})["$gte"] = float(min_price)
    if max_price is not None:
        q.setdefault("price_ton", {})["$lte"] = float(max_price)
    sort_spec = [("created_at", DESCENDING)]
    if sort == "price_asc":  sort_spec = [("price_ton", ASCENDING)]
    if sort == "price_desc": sort_spec = [("price_ton", DESCENDING)]
    total = await listings_col.count_documents(q)
    skip = max(0, (max(1, int(page)) - 1) * int(page_size))
    rows: list[dict] = []
    async for d in listings_col.find(q, {"_id": 0}).sort(sort_spec).skip(skip).limit(page_size):
        # Phase 11.1.1 Part B — normalize image_path to the canonical absolute
        # `/api/static/items/<slug>.png` prefix so every API surface emits the
        # same URL shape (matches /api/inventory + /api/cases).
        if d.get("image_path"):
            d["image_path"] = static_url(d["image_path"])
        rows.append(d)
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


async def my_listings(user_id: str) -> dict[str, Any]:
    active = [d async for d in listings_col.find(
        {"seller_user_id": user_id, "status": "active"}, {"_id": 0},
    ).sort("created_at", DESCENDING)]
    history = [d async for d in listings_col.find(
        {"seller_user_id": user_id, "status": {"$ne": "active"}}, {"_id": 0},
    ).sort("created_at", DESCENDING).limit(50)]
    # Phase 11.1.1 Part B — same canonical-prefix normalization as `browse()`.
    for d in (*active, *history):
        if d.get("image_path"):
            d["image_path"] = static_url(d["image_path"])
    return {"active": active, "history": history}


async def total_fees_collected() -> float:
    total = 0.0
    async for d in fees_col.find({}, {"_id": 0, "fee_ton": 1}):
        total += float(d.get("fee_ton") or 0)
    return round(total, 6)
