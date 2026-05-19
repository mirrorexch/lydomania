"""
Lydomania bot — notifications outbox poller.

Polls the backend's /api/internal/notifications/pending endpoint every 2s,
sends each message via the bot, then ACKs result via /notifications/ack.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

log = logging.getLogger("lydomania.bot.outbox")

POLL_INTERVAL_S = 2.0
BATCH_SIZE = 20


def _backend_url() -> str:
    return os.environ.get("BACKEND_INTERNAL_URL", "http://127.0.0.1:8001")


def _headers() -> dict[str, str]:
    return {"X-Internal-Secret": os.environ.get("INTERNAL_API_SECRET", "")}


async def _fetch_pending(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    r = await client.get(
        f"{_backend_url()}/api/internal/notifications/pending",
        headers=_headers(),
        params={"limit": BATCH_SIZE},
    )
    r.raise_for_status()
    return r.json()


async def _ack(
    client: httpx.AsyncClient, notif_id: str, ok: bool, error: str = ""
) -> None:
    try:
        await client.post(
            f"{_backend_url()}/api/internal/notifications/ack",
            headers={**_headers(), "Content-Type": "application/json"},
            json={"id": notif_id, "success": ok, "error": error or None},
        )
    except httpx.HTTPError as e:  # noqa: BLE001
        log.warning("ack failed for %s: %s", notif_id, e)


async def _send_one(bot: Bot, notif: dict[str, Any]) -> tuple[bool, str]:
    chat_id = int(notif.get("telegram_id"))
    text = notif.get("text", "")
    parse_mode = notif.get("parse_mode") or "HTML"
    try:
        await bot.send_message(
            chat_id=chat_id,
            text=text,
            parse_mode=parse_mode,
            disable_web_page_preview=True,
        )
        return True, ""
    except TelegramAPIError as e:  # noqa: BLE001
        # Common cases: 403 (user blocked bot), 400 (bad chat)
        return False, f"telegram: {e}"
    except Exception as e:  # noqa: BLE001
        return False, f"unexpected: {e}"


async def outbox_loop(bot: Bot) -> None:
    log.info("Notification outbox poller started (interval=%.1fs)", POLL_INTERVAL_S)
    async with httpx.AsyncClient(timeout=8.0) as client:
        while True:
            try:
                batch = await _fetch_pending(client)
                if batch:
                    log.info("Outbox: picked up %d notification(s)", len(batch))
                for notif in batch:
                    ok, err = await _send_one(bot, notif)
                    await _ack(client, notif["id"], ok, err)
                    if not ok:
                        log.warning(
                            "Outbox send FAILED tg=%s kind=%s err=%s",
                            notif.get("telegram_id"),
                            notif.get("kind"),
                            err,
                        )
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("Outbox cycle error: %s", e)
            await asyncio.sleep(POLL_INTERVAL_S)
