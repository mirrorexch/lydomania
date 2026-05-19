"""
Phase 6e — Gift deposit watcher (REWORKED for sandbox bug-fix cycle).

Polls Tonapi for inbound NFT transfers to the vault every TONAPI_POLL_S
seconds. For each event:
  1. Normalises recipient → match against vault.
  2. Extracts memo from multiple candidate fields (comment, text_comment,
     decoded_body.text, payload).
  3. If memo matches a pending intent → credits the user's inventory.
  4. If no memo / wrong memo → inserts into `gift_deposits` with
     queued_admin_review=True AND a synthetic `gift_deposit_intents` row
     with status="unattributed" so it surfaces in the admin queue.
  5. Always preserves the raw event JSON on errors so we never silently lose
     a transfer.

TONAPI_KEY is OPTIONAL — tonapi.io has a free unauthenticated tier whose
rate limits comfortably cover a 6-second poll cycle. If you need higher
QPS, set TONAPI_KEY in `backend/.env`.

All logs are emitted with the `[gift_watcher]` prefix so they're greppable.
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
from typing import Any, Optional

import httpx

from core.config import (
    ENABLE_GIFT_DEPOSITS, TONAPI_BASE, TONAPI_KEY, TONAPI_POLL_S, logger,
)
from core.db import (
    gift_deposit_intents_col, gift_deposits_col, inventory_col, items_col, meta_col,
)
from core.time_utils import iso, now
from core.ton import VAULT_ADDR_NB, VAULT_ADDR_RAW, static_url

# Default placeholder item slug used when we cannot map a real NFT to one of
# our catalog items (e.g. user deposits a Clover Pin, which isn't in our 78
# items). Admin can later rebind to the right slug via the admin queue.
FALLBACK_ITEM_SLUG = "swag_bag"

MEMO_RE = re.compile(r"^gd_[0-9a-f]+_[0-9a-f]+$")


def _normalize_addr(s: str) -> str:
    """Lower-case, drop 0:/UQ/EQ prefix idempotency so we can compare both forms."""
    if not s:
        return ""
    s = s.strip()
    if ":" in s:
        return s.split(":", 1)[1].lower()
    if s.startswith(("UQ", "EQ", "uq", "eq", "0Q", "kQ")):
        # base64url-ish forms — keep as-is for prefix compare
        return s.lower()
    return s.lower()


def _vault_match(addr: str) -> bool:
    n = _normalize_addr(addr)
    targets = {
        _normalize_addr(VAULT_ADDR_RAW),
        _normalize_addr(VAULT_ADDR_NB),
    }
    return any(n and n == t for t in targets)


def _extract_comment(inner: dict, ev: dict) -> str:
    """Try the multiple known places Tonapi can stash the on-chain comment."""
    candidates = [
        inner.get("comment"),
        inner.get("text_comment"),
        (inner.get("decoded_body") or {}).get("text"),
        (inner.get("decoded_body") or {}).get("comment"),
        (inner.get("payload") or {}).get("text"),
        (ev.get("in_progress") and ev.get("text_comment")) or None,
    ]
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c.strip()
    return ""


def _extract_nft_transfer(action: dict) -> Optional[dict]:
    """Tonapi returns the NFT details either nested under NftItemTransfer or
    NftTransfer depending on the API version."""
    if action.get("type") not in {"NftItemTransfer", "NftTransfer"}:
        return None
    return action.get("NftItemTransfer") or action.get("NftTransfer") or None


async def _fetch_recent_events(client: httpx.AsyncClient, limit: int = 50) -> list[dict]:
    """Fetch recent events for the vault. Uses /events (works without API key)
    instead of the deprecated /nft_history."""
    url = f"{TONAPI_BASE}/v2/accounts/{VAULT_ADDR_NB}/events"
    headers = {"Authorization": f"Bearer {TONAPI_KEY}"} if TONAPI_KEY else {}
    try:
        r = await client.get(url, params={"limit": limit}, headers=headers, timeout=20.0)
    except httpx.HTTPError as e:
        logger.warning("[gift_watcher] tonapi fetch failed: %s", e)
        return []
    if r.status_code == 404:
        logger.warning("[gift_watcher] tonapi 404 (vault has no events yet)")
        return []
    if r.status_code == 429:
        logger.warning("[gift_watcher] tonapi rate-limited (429) — sleeping")
        await asyncio.sleep(5)
        return []
    if r.status_code >= 400:
        logger.warning("[gift_watcher] tonapi %s %s", r.status_code, r.text[:200])
        return []
    try:
        body = r.json() or {}
    except json.JSONDecodeError as e:
        logger.warning("[gift_watcher] tonapi non-JSON response: %s", e)
        return []
    return body.get("events", []) or []


async def _credit_intent(intent: dict, *, tx_hash: str, nft_address: Optional[str],
                         collection_address: Optional[str], comment: str) -> Optional[str]:
    """Credit the user's inventory + flip intent → fulfilled. Returns inventory_id."""
    item = await items_col.find_one({"slug": FALLBACK_ITEM_SLUG}, {"_id": 0})
    if not item:
        logger.error("[gift_watcher] FATAL: fallback item %s not in items_col — credit aborted", FALLBACK_ITEM_SLUG)
        return None
    inv_id = secrets.token_hex(12)
    await inventory_col.insert_one({
        "id": inv_id,
        "user_id": intent["user_id"],
        "item_slug": item["slug"],
        "item_name": item.get("name", item["slug"]),
        "rarity": item.get("rarity", "common"),
        "image_path": item.get("image_path", f"items/{item['slug']}.png"),
        "payout_ton": float(item.get("floor_price_ton") or 0.0),
        "status": "in_inventory",
        "case_id": "gift_deposit",
        "roll_id": f"gift_{intent['id']}",
        "source": "gift_deposit",
        "created_at": iso(now()),
        "real_nft_address": nft_address,
        "real_nft_collection": collection_address,
    })
    await gift_deposit_intents_col.update_one(
        {"id": intent["id"]},
        {"$set": {
            "status": "fulfilled",
            "item_slug": item["slug"],
            "item_name": item.get("name"),
            "image_url": static_url(item.get("image_path", f"items/{item['slug']}.png")),
            "tx_hash": tx_hash,
            "nft_address": nft_address,
            "collection_address": collection_address,
            "fulfilled_at": iso(now()),
            "inventory_id": inv_id,
            "credit_comment": comment,
        }},
    )
    return inv_id


async def _process_event(ev: dict) -> None:
    tx_hash = ev.get("event_id") or ev.get("hash")
    if not tx_hash:
        logger.warning("[gift_watcher] event has no id, skipping")
        return

    # Idempotency guard
    if await gift_deposits_col.find_one({"tx_hash": tx_hash}, {"_id": 0}):
        return  # already processed

    actions = ev.get("actions") or []
    if not actions:
        return
    nft_inner = None
    nft_action = None
    for a in actions:
        inner = _extract_nft_transfer(a)
        if inner:
            nft_inner = inner
            nft_action = a
            break
    if not nft_inner:
        return  # not an NFT transfer event

    recipient = (nft_inner.get("recipient") or {}).get("address") or ""
    if not _vault_match(recipient):
        # NFT moved AWAY from the vault, or to another account — ignore.
        logger.info("[gift_watcher] event=%s nft transfer not to vault (recipient=%s) — skipped",
                    tx_hash[:16], recipient[:30])
        return

    sender = (nft_inner.get("sender") or {}).get("address") or ""
    nft_address = nft_inner.get("nft")
    collection_address = (nft_inner.get("collection") or {}).get("address")
    comment = _extract_comment(nft_inner, ev)

    logger.info("[gift_watcher] inbound NFT event=%s nft=%s from=%s comment=%r",
                tx_hash[:16], (nft_address or "?")[:30], sender[:30], comment)

    intent = None
    if comment and MEMO_RE.match(comment):
        intent = await gift_deposit_intents_col.find_one(
            {"memo": comment, "status": "pending"}, {"_id": 0}
        )
        if intent:
            logger.info("[gift_watcher] memo match → intent=%s user=%s",
                        intent["id"], intent["user_id"])
        else:
            logger.info("[gift_watcher] memo present (%s) but no matching pending intent — unattributed",
                        comment)
    else:
        logger.info("[gift_watcher] no memo (or invalid format) — unattributed")

    inv_id: Optional[str] = None
    if intent:
        try:
            inv_id = await _credit_intent(
                intent,
                tx_hash=tx_hash, nft_address=nft_address,
                collection_address=collection_address, comment=comment,
            )
            logger.info("[gift_watcher] CREDIT intent=%s user=%s inv=%s",
                        intent["id"], intent["user_id"], inv_id)
        except Exception as e:  # noqa: BLE001 — never let one event break the loop
            logger.exception("[gift_watcher] credit failed for intent=%s: %s",
                             intent["id"], e)
            intent = None  # fall through to unattributed insert

    if not intent:
        # Surface in admin queue with raw event preserved
        try:
            synth_id = secrets.token_hex(12)
            await gift_deposit_intents_col.insert_one({
                "id": synth_id,
                "user_id": None,
                "telegram_id": None,
                "memo": comment or None,
                "address": VAULT_ADDR_NB,
                "status": "unattributed",
                "tx_hash": tx_hash,
                "nft_address": nft_address,
                "collection_address": collection_address,
                "source_address": sender,
                "raw_event": ev,
                "created_at": iso(now()),
                "expires_at": iso(now()),
            })
            logger.warning("[gift_watcher] UNATTRIBUTED row=%s tx=%s",
                           synth_id, tx_hash[:16])
        except Exception as e:  # noqa: BLE001
            logger.exception("[gift_watcher] failed to insert unattributed row: %s", e)

    try:
        await gift_deposits_col.insert_one({
            "id": secrets.token_hex(12),
            "tx_hash": tx_hash,
            "source_address": sender,
            "nft_address": nft_address,
            "collection_address": collection_address,
            "intent_id": intent["id"] if intent else None,
            "user_id": intent["user_id"] if intent else None,
            "item_slug": FALLBACK_ITEM_SLUG if intent else None,
            "comment": comment,
            "credited": bool(intent),
            "queued_admin_review": not bool(intent),
            "raw_event_preview": {
                "event_id": ev.get("event_id"),
                "timestamp": ev.get("timestamp"),
                "lt": ev.get("lt"),
            },
            "created_at": iso(now()),
        })
    except Exception as e:  # noqa: BLE001
        # Most likely the unique tx_hash index tripped because of a race
        logger.warning("[gift_watcher] gift_deposits insert race for tx=%s: %s",
                       tx_hash[:16], e)


async def gift_deposit_watcher_loop() -> None:
    if not ENABLE_GIFT_DEPOSITS:
        logger.info("[gift_watcher] disabled (ENABLE_GIFT_DEPOSITS=false)")
        return

    # Phase 6e bug-fix: TONAPI works without a key on the free tier — proceed
    # without it, but log when authenticated.
    auth_mode = "authenticated" if TONAPI_KEY else "unauthenticated (free tier)"
    logger.info("[gift_watcher] starting loop — vault=%s poll=%ss mode=%s",
                VAULT_ADDR_NB, TONAPI_POLL_S, auth_mode)

    cycle = 0
    async with httpx.AsyncClient() as client:
        while True:
            cycle += 1
            try:
                events = await _fetch_recent_events(client, limit=50)
                logger.info("[gift_watcher] cycle=%d events=%d", cycle, len(events))
                for ev in events:
                    try:
                        await _process_event(ev)
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:  # noqa: BLE001
                        logger.exception("[gift_watcher] event handler error: %s", e)
                if events:
                    last_id = events[0].get("event_id") or events[0].get("hash")
                    if last_id:
                        await meta_col.update_one(
                            {"id": "gift_deposit_cursor"},
                            {"$set": {"id": "gift_deposit_cursor", "last_event_id": last_id}},
                            upsert=True,
                        )
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception("[gift_watcher] cycle err: %s", e)
            await asyncio.sleep(TONAPI_POLL_S)
