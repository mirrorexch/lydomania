"""Notification outbox enqueue helper (bot polls every 2s and sends DMs)."""
from __future__ import annotations

import secrets
from typing import Optional

from core.db import notifications_col
from core.time_utils import iso, now


async def enqueue_notification(
    telegram_id: int,
    text: str,
    parse_mode: str = "HTML",
    keyboard: Optional[list] = None,
    kind: str = "generic",
) -> None:
    if not telegram_id:
        return
    await notifications_col.insert_one({
        "id": secrets.token_hex(12),
        "telegram_id": int(telegram_id),
        "text": text,
        "parse_mode": parse_mode,
        "keyboard": keyboard,
        "kind": kind,
        "status": "queued",
        "attempts": 0,
        "created_at": iso(now()),
    })
