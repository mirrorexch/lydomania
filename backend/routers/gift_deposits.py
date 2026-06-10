"""Phase 6e — Telegram NFT gift deposit intents (user-facing).

Lets a logged-in user generate a 30-min memo so they can transfer a real
Telegram gift NFT into the vault. The actual on-chain credit is performed
by `services.gift_deposit_watcher` (or, for tests, by the admin
`/admin/gift-deposits/test-credit` endpoint).

All routes are prefixed `/api/inventory/gift-deposits`.
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.config import ENABLE_GIFT_DEPOSITS, TON_NETWORK
from core.db import gift_deposit_intents_col
from core.models import GiftDepositIntentOut, GiftDepositListOut
from core.time_utils import iso, now
from core.ton import VAULT_ADDR_NB

router = APIRouter(prefix="/api/inventory/gift-deposits")

INTENT_TTL_S = 30 * 60  # 30 minutes


def _shape_intent(d: dict) -> GiftDepositIntentOut:
    return GiftDepositIntentOut(
        id=d["id"],
        address=d["address"],
        memo=d["memo"],
        network=d.get("network", TON_NETWORK),
        status=d["status"],
        item_slug=d.get("item_slug"),
        item_name=d.get("item_name"),
        image_url=d.get("image_url"),
        tx_hash=d.get("tx_hash"),
        nft_address=d.get("nft_address"),
        created_at=d["created_at"],
        expires_at=d["expires_at"],
        fulfilled_at=d.get("fulfilled_at"),
    )


@router.post("/intent", response_model=GiftDepositIntentOut)
async def create_gift_deposit_intent(
    user: dict = Depends(get_current_user),
) -> GiftDepositIntentOut:
    if not ENABLE_GIFT_DEPOSITS:
        raise HTTPException(status_code=503, detail="gift deposits disabled")
    # SECURITY: 128-bit nonce (was 24-bit). A short gift memo is brute-forceable,
    # letting an attacker claim another user's inbound gift deposit.
    nonce = secrets.token_hex(16)
    memo = f"gd_{user['id']}_{nonce}"
    expires = now() + timedelta(seconds=INTENT_TTL_S)
    doc = {
        "id": secrets.token_hex(12),
        "user_id": user["id"],
        "telegram_id": user["telegram_id"],
        "nonce": nonce,
        "memo": memo,
        "address": VAULT_ADDR_NB,
        "network": TON_NETWORK,
        "status": "pending",
        "created_at": iso(now()),
        "expires_at": iso(expires),
    }
    await gift_deposit_intents_col.insert_one(doc)
    return _shape_intent(doc)


@router.get("/intent/{intent_id}", response_model=GiftDepositIntentOut)
async def get_gift_deposit_intent(
    intent_id: str,
    user: dict = Depends(get_current_user),
) -> GiftDepositIntentOut:
    d = await gift_deposit_intents_col.find_one(
        {"id": intent_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="intent not found")
    # Expire lazily so polling clients see "expired" without a worker
    if d["status"] == "pending" and d.get("expires_at") and d["expires_at"] < iso(now()):
        await gift_deposit_intents_col.update_one(
            {"id": intent_id}, {"$set": {"status": "expired"}}
        )
        d["status"] = "expired"
    return _shape_intent(d)


@router.get("/list", response_model=GiftDepositListOut)
async def list_my_gift_deposits(
    limit: int = 25,
    user: dict = Depends(get_current_user),
) -> GiftDepositListOut:
    cur = gift_deposit_intents_col.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(max(1, min(limit, 100)))
    out: list[GiftDepositIntentOut] = []
    async for d in cur:
        out.append(_shape_intent(d))
    return GiftDepositListOut(intents=out)
