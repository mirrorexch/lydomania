"""Auth routes: /auth/telegram, /auth/dev-login, /me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import (
    get_current_user, issue_jwt, upsert_user_from_tg,
    user_doc_to_out, verify_telegram_init_data,
)
from core.config import ENABLE_DEV_LOGIN, TELEGRAM_BOT_TOKEN, logger
from core.models import AuthOut, TelegramAuthIn, UserOut
import json as _json

router = APIRouter(prefix="/api")


@router.post("/auth/telegram", response_model=AuthOut)
async def auth_telegram(payload: TelegramAuthIn) -> AuthOut:
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=500, detail="bot token not configured")
    data = verify_telegram_init_data(payload.initData, TELEGRAM_BOT_TOKEN)
    user_payload = {}
    try:
        user_payload = _json.loads(data.get("user", "{}"))
    except Exception:
        raise HTTPException(status_code=401, detail="initData user JSON malformed")
    telegram_id = int(user_payload.get("id") or 0)
    if not telegram_id:
        raise HTTPException(status_code=401, detail="missing user.id in initData")
    user = await upsert_user_from_tg(
        telegram_id=telegram_id,
        username=user_payload.get("username"),
        first_name=user_payload.get("first_name"),
        last_name=user_payload.get("last_name"),
        photo_url=user_payload.get("photo_url"),
    )
    token = issue_jwt(user["id"], telegram_id)
    logger.info("AUTH telegram_id=%s user_id=%s", telegram_id, user["id"])
    return AuthOut(token=token, user=user_doc_to_out(user))


@router.post("/auth/dev-login", response_model=AuthOut)
async def dev_login(
    telegram_id: int = Query(..., ge=1),
    username: str | None = Query(None),
    first_name: str | None = Query(None),
) -> AuthOut:
    if not ENABLE_DEV_LOGIN:
        raise HTTPException(status_code=404, detail="dev login disabled")
    user = await upsert_user_from_tg(
        telegram_id=telegram_id, username=username, first_name=first_name,
    )
    token = issue_jwt(user["id"], telegram_id)
    return AuthOut(token=token, user=user_doc_to_out(user))


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)) -> UserOut:
    return user_doc_to_out(user)


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}
