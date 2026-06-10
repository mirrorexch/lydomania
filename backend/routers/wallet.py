"""Wallet routes: /wallet/*."""
from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import get_current_user
from core.config import DEPOSIT_INTENT_TTL_S, ENABLE_DEV_LOGIN, TON_NETWORK
from core.db import intents_col, users_col
from core.models import BalanceOut, DepositAddressOut
from core.time_utils import iso, now
from core.ton import VAULT_ADDR_B, VAULT_ADDR_NB

router = APIRouter(prefix="/api")


@router.get("/wallet/deposit-address", response_model=DepositAddressOut)
async def deposit_address(user: dict = Depends(get_current_user)) -> DepositAddressOut:
    # SECURITY: 128-bit nonce. A short nonce lets an attacker brute-force a victim's
    # deposit memo and redirect their incoming TON to their own intent.
    nonce = secrets.token_hex(16)
    memo = f"dep:{user['id']}:{nonce}"
    expires = now() + timedelta(seconds=DEPOSIT_INTENT_TTL_S)
    await intents_col.insert_one({
        "id": secrets.token_hex(12),
        "user_id": user["id"],
        "telegram_id": user["telegram_id"],
        "nonce": nonce, "memo": memo, "status": "pending",
        "created_at": iso(now()), "expires_at": iso(expires),
    })
    return DepositAddressOut(
        address=VAULT_ADDR_NB, memo=memo, network=TON_NETWORK, expires_at=iso(expires),
    )


@router.get("/wallet/balance", response_model=BalanceOut)
async def get_balance(user: dict = Depends(get_current_user)) -> BalanceOut:
    fresh = await users_col.find_one({"id": user["id"]}, {"_id": 0})
    return BalanceOut(balance_ton=float(fresh.get("balance_ton", 0.0)))


@router.post("/wallet/dev-credit", response_model=BalanceOut)
async def dev_credit(
    amount: float = Query(..., gt=0, le=10_000),
    user: dict = Depends(get_current_user),
) -> BalanceOut:
    if not ENABLE_DEV_LOGIN:
        raise HTTPException(status_code=404, detail="dev-credit disabled")
    fresh = await users_col.find_one_and_update(
        {"id": user["id"]},
        {"$inc": {"balance_ton": float(amount)}, "$set": {"updated_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    return BalanceOut(balance_ton=float(fresh["balance_ton"]))


@router.get("/wallet/vault-info")
async def vault_info() -> dict:
    return {
        "address_uq": VAULT_ADDR_NB,
        "address_eq": VAULT_ADDR_B,
        "network": TON_NETWORK,
    }
