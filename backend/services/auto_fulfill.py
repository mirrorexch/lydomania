"""
Phase 3b — Auto-fulfill worker skeleton.

Rails only — by default this worker is DISABLED via settings.auto_fulfill_enabled,
AND threshold_ton=0 effectively skips every withdrawal, AND DRY_RUN is hard-defaulted
true at module level. Real TON-send + Portals purchase logic is stubbed with TODOs.

Hard safety gates (in order):
  1. settings.auto_fulfill_enabled must be True
  2. threshold gate: payout_ton <= auto_fulfill_threshold_ton
  3. daily-cap circuit breaker: cumulative auto-fulfilled today < auto_fulfill_daily_cap_ton
  4. failure cooldown: 3 consecutive failures → disable worker 1h + DM admins
  5. DRY_RUN mode (default True): never sends actual TON
"""
from __future__ import annotations

import asyncio
import secrets
from datetime import timedelta
from typing import Any

from core.config import ADMIN_TELEGRAM_IDS, logger
from core.db import (
    auto_fulfill_log_col, gift_floor_prices_col, inventory_col,
    settings_col, withdrawals_col,
)
from core.time_utils import iso, now
from services.notifications import enqueue_notification
from services.portals_client import get_portals_client
from services.settings import get_settings
from services.ton_sender import send_nft_transfer

POLL_INTERVAL_S = 30
DRY_RUN_DEFAULT = True
FAILURE_COOLDOWN_THRESHOLD = 3
COOLDOWN_HOURS = 1


async def _audit(entry: dict[str, Any]) -> None:
    entry.setdefault("id", secrets.token_hex(12))
    entry.setdefault("created_at", iso(now()))
    await auto_fulfill_log_col.insert_one(entry)


async def _today_total_auto_fulfilled() -> float:
    today_start = iso(now().replace(hour=0, minute=0, second=0, microsecond=0))
    pipe = [
        {"$match": {
            "kind": "auto_fulfill_success",
            "dry_run": False,
            "created_at": {"$gte": today_start},
        }},
        {"$group": {"_id": None, "v": {"$sum": "$payout_ton"}}},
    ]
    doc = await auto_fulfill_log_col.aggregate(pipe).to_list(1)
    return float(doc[0]["v"]) if doc else 0.0


async def _consecutive_failures() -> int:
    """Count failures since the last success."""
    count = 0
    async for entry in auto_fulfill_log_col.find(
        {"kind": {"$in": ["auto_fulfill_success", "auto_fulfill_failure"]}, "dry_run": False},
        {"_id": 0, "kind": 1},
    ).sort("created_at", -1).limit(20):
        if entry["kind"] == "auto_fulfill_failure":
            count += 1
        else:
            break
    return count


async def _is_in_cooldown() -> bool:
    """Cooldown lasts COOLDOWN_HOURS after a triggered cooldown DM."""
    doc = await auto_fulfill_log_col.find_one(
        {"kind": "cooldown_triggered"},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if not doc:
        return False
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
        return (now() - dt).total_seconds() < COOLDOWN_HOURS * 3600
    except Exception:
        return False


async def _dm_admins(text: str, kind: str) -> None:
    for tid in ADMIN_TELEGRAM_IDS:
        await enqueue_notification(int(tid), text, kind=kind)


async def _attempt_buy_and_send(withdrawal: dict, dry_run: bool) -> tuple[bool, str, dict[str, Any]]:
    """
    STUB · Phase 3b: real Portal purchase + TON-send logic NOT implemented here.
    Returns (success, message, diagnostics).
    """
    diag: dict[str, Any] = {
        "destination": withdrawal.get("destination_address", "unknown"),
        "item_slug": withdrawal.get("item_slug", "unknown"),
        "payout_ton": float(withdrawal.get("payout_ton", 0)),
    }
    if not withdrawal.get("destination_address"):
        return False, "withdrawal has no destination_address (legacy doc)", diag
    # Step 1: check live floor (informational)
    fp = await gift_floor_prices_col.find_one({"slug": withdrawal["item_slug"]}, {"_id": 0})
    if fp and fp.get("floor_ton"):
        diag["live_floor_ton"] = float(fp["floor_ton"])
        if float(fp["floor_ton"]) > float(withdrawal["payout_ton"]) * 1.1:
            return False, f"floor {fp['floor_ton']:.2f} > 110% of payout {withdrawal['payout_ton']:.2f}", diag

    if dry_run:
        diag["mode"] = "dry_run"
        # Phase 4b: build the message body and resolve a listing so the dry-run
        # trace matches the real flow (just no network calls + no spend).
        client = await get_portals_client()
        listing = await client.cheapest_for_slug(
            withdrawal["item_slug"],
            max_price_ton=float(withdrawal["payout_ton"]) * 1.1,
        )
        diag["resolved_listing"] = listing
        if not listing:
            return False, "DRY-RUN — no listing matched within 110% of payout", diag
        send = await send_nft_transfer(
            nft_address=listing["nft_address"],
            new_owner=withdrawal["destination_address"],
            dry_run=True,
        )
        diag["ton_send"] = {k: v for k, v in send.items() if k != "body_boc_b64"}
        diag["body_boc_size_b64"] = len(send.get("body_boc_b64") or "")
        return bool(send.get("ok")), "DRY-RUN — purchase + send simulated", diag

    # ---- REAL on-chain auto-fulfill (Phase 4b) ----
    client = await get_portals_client()
    listing = await client.cheapest_for_slug(
        withdrawal["item_slug"],
        max_price_ton=float(withdrawal["payout_ton"]) * 1.1,
    )
    if not listing:
        return False, "no listing matched within 110% of payout", diag
    diag["resolved_listing"] = listing
    purchase = await client.purchase(listing)
    diag["purchase"] = purchase
    if not purchase.get("ok"):
        return False, f"purchase failed: {purchase.get('error', 'unknown')}", diag
    received = await client.confirm_received(purchase, timeout_s=120)
    diag["receive_confirmation"] = received
    if not received.get("ok"):
        return False, f"NFT delivery to vault unconfirmed: {received.get('error', 'unknown')}", diag
    send = await send_nft_transfer(
        nft_address=purchase["nft_address"],
        new_owner=withdrawal["destination_address"],
        dry_run=False,
    )
    diag["ton_send"] = {k: v for k, v in send.items() if k != "body_boc_b64"}
    if not send.get("ok"):
        return False, f"ton send failed: {send.get('error', 'unknown')}", diag
    diag["tx_hash"] = send.get("tx_hash")
    return True, "purchased + sent on-chain", diag


async def auto_fulfill_once() -> dict:
    """Run a single auto-fulfill cycle. Returns summary."""
    settings = await get_settings()
    if not settings.get("auto_fulfill_enabled", False):
        return {"skipped": True, "reason": "disabled"}
    threshold = float(settings.get("auto_fulfill_threshold_ton", 0.0))
    if threshold <= 0:
        return {"skipped": True, "reason": "threshold_zero"}
    if await _is_in_cooldown():
        return {"skipped": True, "reason": "cooldown_active"}
    daily_cap = float(settings.get("auto_fulfill_daily_cap_ton", 100.0))
    today_total = await _today_total_auto_fulfilled()
    if today_total >= daily_cap:
        return {"skipped": True, "reason": "daily_cap_hit", "today_total": today_total}

    # Snapshot of dry-run preference (default True even if enabled)
    dry_run = bool(settings.get("auto_fulfill_dry_run", DRY_RUN_DEFAULT))

    eligible_q = {
        "status": "pending",
        "payout_ton": {"$lte": threshold},
    }
    processed = 0
    succeeded = 0
    failed = 0
    async for w in withdrawals_col.find(eligible_q, {"_id": 0}).sort("requested_at", 1).limit(20):
        # Stop if daily cap would be exceeded for real runs
        if not dry_run and today_total + float(w["payout_ton"]) > daily_cap:
            await _audit({"kind": "skip_cap", "withdrawal_id": w["id"], "dry_run": dry_run,
                          "payout_ton": float(w["payout_ton"]), "today_total": today_total})
            break

        ok, msg, diag = await _attempt_buy_and_send(w, dry_run)
        processed += 1
        if ok:
            succeeded += 1
            if not dry_run:
                today_total += float(w["payout_ton"])
            await _audit({
                "kind": "auto_fulfill_success" if not dry_run else "dry_run_success",
                "withdrawal_id": w["id"], "user_id": w.get("user_id"),
                "item_slug": w["item_slug"], "payout_ton": float(w["payout_ton"]),
                "destination_address": w["destination_address"],
                "message": msg, "diag": diag, "dry_run": dry_run,
            })
        else:
            failed += 1
            await _audit({
                "kind": "auto_fulfill_failure",
                "withdrawal_id": w["id"], "user_id": w.get("user_id"),
                "item_slug": w["item_slug"], "payout_ton": float(w["payout_ton"]),
                "message": msg, "diag": diag, "dry_run": dry_run,
            })
            # Cooldown check after each real failure
            if not dry_run:
                fails = await _consecutive_failures()
                if fails >= FAILURE_COOLDOWN_THRESHOLD:
                    await _audit({
                        "kind": "cooldown_triggered",
                        "consecutive_failures": fails,
                        "cooldown_until": iso(now() + timedelta(hours=COOLDOWN_HOURS)),
                    })
                    await _dm_admins(
                        f"🚨 <b>Auto-fulfill cooldown engaged</b>\n"
                        f"3 consecutive failures. Worker disabled for {COOLDOWN_HOURS}h.\n"
                        f"Last error: <i>{msg}</i>",
                        kind="auto_fulfill_cooldown",
                    )
                    break

    return {"processed": processed, "succeeded": succeeded, "failed": failed,
            "dry_run": dry_run, "today_total_after": today_total}


async def auto_fulfill_loop() -> None:
    logger.info(
        "auto-fulfill loop started · poll=%ds · dry_run_default=%s · cooldown_threshold=%d failures",
        POLL_INTERVAL_S, DRY_RUN_DEFAULT, FAILURE_COOLDOWN_THRESHOLD,
    )
    await asyncio.sleep(20)
    while True:
        try:
            await auto_fulfill_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("auto-fulfill cycle error: %s", e)
        await asyncio.sleep(POLL_INTERVAL_S)
