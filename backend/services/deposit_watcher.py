"""Background watcher: polls toncenter for inbound TON, credits user balances."""
from __future__ import annotations

import asyncio
import base64
import secrets
from typing import Any, Optional

import httpx

from core.config import (
    POLL_INTERVAL_S, TONCENTER_API_BASE, TONCENTER_API_KEY, logger,
)
from core.db import deposits_col, intents_col, meta_col, users_col
from core.time_utils import iso, now
from core.ton import VAULT_ADDR_NB
from services.notifications import enqueue_t


async def _fetch_transactions(address: str, limit: int = 50) -> list[dict]:
    params: dict[str, Any] = {"address": address, "limit": limit, "archival": "true"}
    headers = {}
    if TONCENTER_API_KEY:
        headers["X-API-Key"] = TONCENTER_API_KEY
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(f"{TONCENTER_API_BASE}/getTransactions", params=params, headers=headers)
        r.raise_for_status()
        body = r.json()
    if not body.get("ok"):
        raise RuntimeError(f"toncenter error: {body}")
    return body.get("result", []) or []


def _parse_comment(tx: dict) -> Optional[str]:
    in_msg = tx.get("in_msg") or {}
    text = in_msg.get("message")
    if isinstance(text, str) and text:
        return text
    msg_data = in_msg.get("msg_data") or {}
    if msg_data.get("@type") == "msg.dataText":
        raw = msg_data.get("text", "")
        try:
            data = base64.b64decode(raw)
        except Exception:
            return None
        if len(data) >= 4 and data[:4] == b"\x00\x00\x00\x00":
            try:
                return data[4:].decode("utf-8")
            except UnicodeDecodeError:
                return None
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return None
    return None


async def _process_tx(tx: dict) -> None:
    in_msg = tx.get("in_msg") or {}
    src = in_msg.get("source") or ""
    if not src:
        return
    value_nanotons = int(in_msg.get("value") or "0")
    if value_nanotons <= 0:
        return
    amount_ton = value_nanotons / 1_000_000_000
    tx_hash = (tx.get("transaction_id") or {}).get("hash") or tx.get("hash")
    lt = int((tx.get("transaction_id") or {}).get("lt") or tx.get("lt") or 0)
    if not tx_hash:
        return
    if await deposits_col.find_one({"tx_hash": tx_hash}, {"_id": 0}):
        return
    comment = _parse_comment(tx) or ""
    intent_id = None
    user_id = None
    credited = False
    if comment.startswith("dep:"):
        parts = comment.split(":", 2)
        if len(parts) == 3:
            _, uid, nonce = parts
            intent = await intents_col.find_one(
                {"user_id": uid, "nonce": nonce, "status": "pending"}, {"_id": 0}
            )
            if intent:
                intent_id = intent["id"]
                user_id = uid
                await users_col.update_one(
                    {"id": uid},
                    {"$inc": {"balance_ton": amount_ton}, "$set": {"updated_at": iso(now())}},
                )
                await intents_col.update_one(
                    {"id": intent_id},
                    {"$set": {"status": "fulfilled", "fulfilled_at": iso(now()), "amount_ton": amount_ton, "tx_hash": tx_hash}},
                )
                credited = True
    await deposits_col.insert_one({
        "id": secrets.token_hex(12),
        "tx_hash": tx_hash, "lt": lt, "source": src,
        "amount_ton": amount_ton, "comment": comment,
        "user_id": user_id, "intent_id": intent_id,
        "credited": credited, "created_at": iso(now()),
    })
    if credited:
        logger.info("DEPOSIT credited %.9f TON to user=%s tx=%s", amount_ton, user_id, tx_hash)
        u = await users_col.find_one({"id": user_id}, {"_id": 0})
        if u:
            tonscan = f"https://tonviewer.com/transaction/{tx_hash}"
            await enqueue_t(
                int(u["telegram_id"]),
                "deposit_confirmed",
                kind="deposit_confirmed",
                amount=amount_ton,
                new_balance=float(u.get("balance_ton", 0)) + amount_ton,
                tonscan=tonscan,
            )
    else:
        logger.info("DEPOSIT seen (uncredited: bad/no memo) amount=%.9f tx=%s comment=%r", amount_ton, tx_hash, comment)


async def deposit_watcher_loop() -> None:
    logger.info("Deposit watcher started — polling %s every %ss on %s", VAULT_ADDR_NB, POLL_INTERVAL_S, TONCENTER_API_BASE)
    meta = await meta_col.find_one({"id": "deposit_cursor"}, {"_id": 0}) or {}
    last_lt = int(meta.get("last_lt", 0))
    while True:
        try:
            txs = await _fetch_transactions(VAULT_ADDR_NB, limit=50)
            txs.sort(key=lambda t: int((t.get("transaction_id") or {}).get("lt") or 0))
            new_max = last_lt
            for tx in txs:
                lt = int((tx.get("transaction_id") or {}).get("lt") or 0)
                if lt <= last_lt:
                    continue
                await _process_tx(tx)
                if lt > new_max:
                    new_max = lt
            if new_max > last_lt:
                last_lt = new_max
                await meta_col.update_one(
                    {"id": "deposit_cursor"},
                    {"$set": {"id": "deposit_cursor", "last_lt": last_lt}},
                    upsert=True,
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Watcher cycle error: %s", e)
        await asyncio.sleep(POLL_INTERVAL_S)
