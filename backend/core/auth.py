"""JWT + user upsert + auth dependencies."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Optional
from urllib.parse import parse_qsl

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from nanoid import generate as nano_gen

from core.config import (
    JWT_ALG, JWT_SECRET, JWT_TTL_HOURS, is_admin_tid, logger,
)
from core.db import pending_refs_col, users_col
from core.models import UserOut
from core.time_utils import iso, now

bearer = HTTPBearer(auto_error=True)

REF_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def gen_ref_code() -> str:
    return nano_gen(REF_CODE_ALPHABET, 8)


def user_doc_to_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"],
        telegram_id=doc["telegram_id"],
        username=doc.get("username"),
        first_name=doc.get("first_name"),
        last_name=doc.get("last_name"),
        photo_url=doc.get("photo_url"),
        balance_ton=float(doc.get("balance_ton", 0.0)),
        is_admin=is_admin_tid(doc.get("telegram_id")),
    )


def issue_jwt(user_id: str, telegram_id: int) -> str:
    payload = {
        "sub": user_id,
        "tid": telegram_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_TTL_HOURS * 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_jwt(token: str) -> dict:
    """Decode + verify a JWT. Raises `jwt.PyJWTError` on bad signature/expiry."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict[str, str]:
    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
    data = dict(pairs)
    received_hash = data.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="initData missing hash")

    data_check_string = "\n".join(f"{k}={data[k]}" for k in sorted(data.keys()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    computed = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, received_hash):
        raise HTTPException(status_code=401, detail="initData hash mismatch")

    try:
        auth_date = int(data.get("auth_date", "0"))
    except ValueError:
        auth_date = 0
    if auth_date <= 0 or (int(time.time()) - auth_date) > 24 * 3600:
        raise HTTPException(status_code=401, detail="initData expired")
    return data


async def upsert_user_from_tg(
    telegram_id: int,
    username: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    photo_url: Optional[str] = None,
    language_code: Optional[str] = None,
) -> dict:
    user_id = secrets.token_hex(12)
    ref_code = gen_ref_code()
    set_on_insert = {
        "id": user_id,
        "telegram_id": telegram_id,
        "balance_ton": 0.0,
        "referral_balance": 0.0,
        "ref_code": ref_code,
        "referred_by_user_id": None,
        "created_at": iso(now()),
    }
    update_set: dict[str, Any] = {"updated_at": iso(now())}
    for k, v in {
        "username": username,
        "first_name": first_name,
        "last_name": last_name,
        "photo_url": photo_url,
        "language_code": language_code,
    }.items():
        if v is not None:
            update_set[k] = v
    doc = await users_col.find_one_and_update(
        {"telegram_id": telegram_id},
        {"$setOnInsert": set_on_insert, "$set": update_set},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    # Consume any pending referral attribution
    if not doc.get("referred_by_user_id"):
        pending = await pending_refs_col.find_one(
            {"telegram_id": telegram_id}, {"_id": 0}
        )
        if pending:
            referrer = await users_col.find_one(
                {"ref_code": pending["ref_code"]}, {"_id": 0}
            )
            # Self-referral block: handled here too (defensive)
            if referrer and referrer["id"] != doc["id"]:
                await users_col.update_one(
                    {"id": doc["id"]},
                    {"$set": {"referred_by_user_id": referrer["id"]}},
                )
                doc["referred_by_user_id"] = referrer["id"]
                logger.info(
                    "REFERRAL tagged user=%s referrer=%s code=%s",
                    doc["id"], referrer["id"], pending["ref_code"],
                )
            await pending_refs_col.delete_one({"telegram_id": telegram_id})
    return doc


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e}")
    user = await users_col.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    # Phase 11.6-C — stamp `last_seen` on every authenticated request.
    # Used by /api/stats/online (5-minute sliding-window counter) and by
    # any future presence-related feature (DM availability, live activity
    # avatar dot, etc.). Fire-and-forget update — we don't want to block
    # the response on a write, and the value being a few ms stale is fine.
    try:
        n = now()
        await users_col.update_one({"id": user["id"]}, {"$set": {"last_seen": n}})
        user["last_seen"] = n
    except Exception:
        # Never let presence bookkeeping break a real request.
        pass
    return user


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if not is_admin_tid(user.get("telegram_id")):
        raise HTTPException(status_code=403, detail="admin only")
    return user
