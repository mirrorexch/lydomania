"""HTTP client used by the bot to talk to the FastAPI backend via /api/internal/*."""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx


def _base() -> str:
    return os.environ.get("BACKEND_INTERNAL_URL", "http://127.0.0.1:8001")


def _headers() -> dict[str, str]:
    return {"X-Internal-Secret": os.environ.get("INTERNAL_API_SECRET", "")}


async def get_balance(telegram_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(
            f"{_base()}/api/internal/user/{telegram_id}/balance",
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


async def deposit_intent(telegram_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.post(
            f"{_base()}/api/internal/user/{telegram_id}/deposit-intent",
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


async def list_cases() -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(f"{_base()}/api/internal/cases", headers=_headers())
        r.raise_for_status()
        return r.json()


async def tag_referral(telegram_id: int, ref_code: str) -> Optional[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(
                f"{_base()}/api/internal/referrals/tag",
                headers={**_headers(), "Content-Type": "application/json"},
                json={"telegram_id": telegram_id, "ref_code": ref_code},
            )
            return r.json() if r.status_code == 200 else None
    except httpx.HTTPError:
        return None


async def set_user_language(telegram_id: int, language_code: str) -> Optional[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(
                f"{_base()}/api/internal/user/{telegram_id}/language",
                headers={**_headers(), "Content-Type": "application/json"},
                json={"language_code": language_code},
            )
            return r.json() if r.status_code == 200 else None
    except httpx.HTTPError:
        return None
