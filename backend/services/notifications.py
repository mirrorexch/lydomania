"""Notification outbox enqueue helper (bot polls every 2s and sends DMs)."""
from __future__ import annotations

import secrets
from typing import Optional

from core.db import notifications_col, users_col
from core.time_utils import iso, now
from services.i18n import bot_text, user_lang_code


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


async def enqueue_t(
    telegram_id: int,
    key: str,
    *,
    kind: str = "generic",
    keyboard: Optional[list] = None,
    parse_mode: str = "HTML",
    **fmt,
) -> None:
    """
    Look up the recipient's language_code from users collection, render the
    template and enqueue. Falls back to English if no user record exists.
    """
    if not telegram_id:
        return
    user = await users_col.find_one(
        {"telegram_id": int(telegram_id)},
        projection={"_id": 0, "language_code": 1},
    )
    lang = user_lang_code(user)
    text = bot_text(lang, key, **fmt)
    await enqueue_notification(
        int(telegram_id),
        text,
        parse_mode=parse_mode,
        keyboard=keyboard,
        kind=kind,
    )
