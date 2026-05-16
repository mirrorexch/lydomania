"""
Phase 4b — TON on-chain sender (TIP-62 NFT transfer).

Builds, signs, and broadcasts an NFT transfer message from the vault wallet
to an arbitrary owner. Confirmation polled via toncenter `getTransactions`.

Two modes (selected by `dry_run` flag):
  • dry_run=True (default) — build the message body, log the BOC bytes,
    return a fake tx_hash. NO network calls, NO TON spent.
  • dry_run=False — sign with vault mnemonic, POST sendBoc to toncenter,
    poll getTransactions on the NFT contract for the resulting tx.

TIP-62 transfer body:
    nft_transfer#5fcc3d14
        query_id : uint64
        new_owner : MsgAddress
        response_destination : MsgAddress
        custom_payload : (Maybe ^Cell)   — null
        forward_ton_amount : Coins       — ~0.001 TON
        forward_payload : (Either Cell ^Cell)
"""
from __future__ import annotations

import base64
import secrets
import time
from typing import Any, Optional

import httpx
from tonsdk.boc import Cell, begin_cell
from tonsdk.contract.wallet import Wallets, WalletVersionEnum
from tonsdk.utils import Address, to_nano

from core.config import (
    TON_VAULT_MNEMONIC, TONCENTER_API_BASE, TONCENTER_API_KEY, logger,
)

NFT_TRANSFER_OP = 0x5fcc3d14
DEFAULT_FORWARD_TON = 1_000_000      # 0.001 TON forward to new owner (nft_ownership_assigned notification)
DEFAULT_MSG_VALUE = 50_000_000       # 0.05 TON to cover fees + forward


def _vault_wallet():
    words = TON_VAULT_MNEMONIC.strip().split()
    if len(words) not in (12, 18, 24):
        raise RuntimeError("TON_VAULT_MNEMONIC must be 12/18/24 words")
    _mn, _pub, _priv, wallet = Wallets.from_mnemonics(
        mnemonics=words, version=WalletVersionEnum.v4r2, workchain=0
    )
    return wallet, _priv


def build_nft_transfer_body(
    new_owner: str,
    response_destination: Optional[str] = None,
    forward_ton_amount: int = DEFAULT_FORWARD_TON,
    query_id: Optional[int] = None,
) -> Cell:
    """Build the TIP-62 NFT transfer body Cell."""
    qid = int(query_id) if query_id is not None else int(time.time() * 1000) & 0xFFFF_FFFF_FFFF_FFFF
    resp = response_destination or new_owner
    cell = (
        begin_cell()
        .store_uint(NFT_TRANSFER_OP, 32)
        .store_uint(qid, 64)
        .store_address(Address(new_owner))
        .store_address(Address(resp))
        .store_bit(0)             # custom_payload: nothing
        .store_coins(int(forward_ton_amount))
        .store_bit(0)             # forward_payload: empty (inline)
        .end_cell()
    )
    return cell


async def _toncenter_get_seqno(address_str: str) -> int:
    params: dict[str, Any] = {"address": address_str}
    headers = {}
    if TONCENTER_API_KEY:
        headers["X-API-Key"] = TONCENTER_API_KEY
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get(f"{TONCENTER_API_BASE}/runGetMethod", params={
            **params, "method": "seqno", "stack": "[]",
        }, headers=headers)
    if r.status_code != 200:
        return 0
    try:
        j = r.json()
        # stack: [[ "num", "0xABC" ]] in v2
        stack = (j.get("result") or {}).get("stack") or []
        if stack and isinstance(stack[0], list) and len(stack[0]) >= 2:
            v = stack[0][1]
            return int(v, 16) if isinstance(v, str) and v.startswith("0x") else int(v)
    except Exception:
        pass
    return 0


async def _toncenter_send_boc(boc_b64: str) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if TONCENTER_API_KEY:
        headers["X-API-Key"] = TONCENTER_API_KEY
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(f"{TONCENTER_API_BASE}/sendBoc", json={"boc": boc_b64}, headers=headers)
    return {"status": r.status_code, "body": r.text}


async def _toncenter_get_transactions(address: str, limit: int = 10) -> list[dict[str, Any]]:
    headers = {}
    if TONCENTER_API_KEY:
        headers["X-API-Key"] = TONCENTER_API_KEY
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get(f"{TONCENTER_API_BASE}/getTransactions", params={
            "address": address, "limit": limit, "archival": True,
        }, headers=headers)
    if r.status_code != 200:
        return []
    try:
        return r.json().get("result") or []
    except Exception:
        return []


async def send_nft_transfer(
    nft_address: str,
    new_owner: str,
    *,
    dry_run: bool = True,
    forward_ton_amount: int = DEFAULT_FORWARD_TON,
    msg_value: int = DEFAULT_MSG_VALUE,
    confirmation_timeout_s: int = 90,
) -> dict[str, Any]:
    """Build + (optionally) send a TIP-62 NFT transfer from the vault wallet.

    Returns: {ok, tx_hash, mode, body_boc_b64, seqno_before, ...}
    """
    try:
        body = build_nft_transfer_body(new_owner=new_owner, forward_ton_amount=forward_ton_amount)
    except Exception as e:
        return {"ok": False, "error": f"build_body_failed: {e}", "mode": "dry_run" if dry_run else "real"}

    body_boc_b64 = base64.b64encode(body.to_boc(False)).decode("ascii")

    if dry_run:
        fake_hash = "drydry" + secrets.token_hex(28)
        logger.info("ton_sender.dry_run nft=%s → owner=%s value=%d forward=%d body_len=%d",
                    nft_address, new_owner, msg_value, forward_ton_amount, len(body_boc_b64))
        return {
            "ok": True, "mode": "dry_run",
            "tx_hash": fake_hash,
            "nft_address": nft_address, "new_owner": new_owner,
            "msg_value_nano": msg_value, "forward_ton_amount_nano": forward_ton_amount,
            "body_boc_b64": body_boc_b64,
        }

    # ---- REAL ----
    try:
        wallet, priv = _vault_wallet()
    except Exception as e:
        return {"ok": False, "error": f"wallet_init_failed: {e}", "mode": "real"}
    vault_addr = wallet.address.to_string(True, True, False)
    seqno = await _toncenter_get_seqno(vault_addr)
    # Build external message (vault → nft contract)
    try:
        query = wallet.create_transfer_message(
            to_addr=nft_address,
            amount=int(msg_value),
            seqno=int(seqno),
            payload=body,
            send_mode=3,  # pay fees separately + ignore errors
        )
        signed_message_boc = query["message"].to_boc(False)
        boc_b64 = base64.b64encode(signed_message_boc).decode("ascii")
    except Exception as e:
        return {"ok": False, "error": f"sign_failed: {e}", "mode": "real", "seqno_before": seqno}
    # Broadcast
    send_resp = await _toncenter_send_boc(boc_b64)
    if send_resp.get("status") != 200:
        return {"ok": False, "error": f"sendBoc {send_resp.get('status')} {send_resp.get('body')[:200]}",
                "mode": "real", "seqno_before": seqno}
    # Poll the NFT contract for incoming tx referencing our op
    started = time.monotonic()
    confirmed_tx_hash = None
    while time.monotonic() - started < confirmation_timeout_s:
        txs = await _toncenter_get_transactions(nft_address, limit=5)
        for tx in txs:
            in_msg = (tx or {}).get("in_msg") or {}
            if in_msg.get("source") == vault_addr:
                confirmed_tx_hash = tx.get("transaction_id", {}).get("hash")
                break
        if confirmed_tx_hash:
            break
        import asyncio
        await asyncio.sleep(3)
    return {
        "ok": bool(confirmed_tx_hash),
        "mode": "real",
        "tx_hash": confirmed_tx_hash,
        "nft_address": nft_address, "new_owner": new_owner,
        "msg_value_nano": msg_value, "forward_ton_amount_nano": forward_ton_amount,
        "seqno_before": seqno,
        "error": None if confirmed_tx_hash else "confirmation_timeout",
    }
