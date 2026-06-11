"""Lydomania — env configuration + constants."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent  # /app/backend
STATIC_DIR = ROOT_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT_DIR / ".env")

# Env (raises KeyError on missing required) ---------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "")
TON_VAULT_MNEMONIC = os.environ["TON_VAULT_MNEMONIC"]
TON_NETWORK = os.environ.get("TON_NETWORK", "mainnet")
TONCENTER_API_BASE = os.environ.get("TONCENTER_API_BASE", "https://toncenter.com/api/v2")
TONCENTER_API_KEY = os.environ.get("TONCENTER_API_KEY", "")
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
JWT_TTL_HOURS = 24
ENABLE_DEV_LOGIN = os.environ.get("ENABLE_DEV_LOGIN", "false").lower() == "true"
_IS_MAINNET = TON_NETWORK.strip().lower() == "mainnet"
# SECURITY: the dev-login backdoor mints a JWT for ANY telegram_id with no auth.
# On mainnet it must never be enabled — refuse to boot rather than run exposed.
if ENABLE_DEV_LOGIN and _IS_MAINNET:
    raise RuntimeError(
        "ENABLE_DEV_LOGIN=true is forbidden on mainnet — it lets anyone mint a JWT "
        "for any user via POST /api/auth/dev-login. Set ENABLE_DEV_LOGIN=false."
    )
if ENABLE_DEV_LOGIN:
    logging.getLogger("lydomania").warning(
        "  ⚠⚠⚠  ENABLE_DEV_LOGIN=true — DEV BACKDOOR ACTIVE  ⚠⚠⚠"
    )
    logging.getLogger("lydomania").warning(
        "  Any caller can mint a JWT for any telegram_id via POST /api/auth/dev-login."
    )
    logging.getLogger("lydomania").warning(
        "  Set ENABLE_DEV_LOGIN=false (or unset) in production .env immediately."
    )
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")
# SECURITY: on mainnet these guard admin + service-to-service auth. An empty value
# means a wide-open or predictable surface, so refuse to boot without them.
if _IS_MAINNET and not INTERNAL_API_SECRET:
    raise RuntimeError("INTERNAL_API_SECRET is required on mainnet (internal API would be unprotected).")
if _IS_MAINNET and not ADMIN_API_KEY:
    raise RuntimeError("ADMIN_API_KEY is required on mainnet (admin portals auth would fall back to a default).")
MINI_APP_URL = os.environ.get("MINI_APP_URL", "")

# Game tuning ---------------------------------------------------------------
POLL_INTERVAL_S = 15
DEPOSIT_INTENT_TTL_S = 3600  # 1h
ROTATE_NONCE_EVERY = 100
REFERRAL_PCT = float(os.environ.get("REFERRAL_PCT", "0.05"))  # Bronze default
BATCH_OPEN_MAX = 10

# Phase 6e — gift deposits
ENABLE_GIFT_DEPOSITS = os.environ.get("ENABLE_GIFT_DEPOSITS", "false").lower() == "true"
TONAPI_BASE = os.environ.get("TONAPI_BASE", "https://tonapi.io").rstrip("/")
TONAPI_KEY = os.environ.get("TONAPI_KEY", "").strip()
TONAPI_POLL_S = int(os.environ.get("TONAPI_POLL_S", "6"))

# Phase 6e — Roulette gift mode
ROULETTE_PRIZE_MODE = os.environ.get("ROULETTE_PRIZE_MODE", "gifts").lower()   # "gifts" | "ton"
ROULETTE_SELL_THRESHOLD_TON = float(os.environ.get("ROULETTE_SELL_THRESHOLD_TON", "100"))


def _parse_id_set(env_name: str) -> set[int]:
    raw = os.environ.get(env_name, "").strip()
    out: set[int] = set()
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            out.add(int(chunk))
        except ValueError:
            continue
    return out


# Full admins: unrestricted access to the admin surface (read + write).
ADMIN_TELEGRAM_IDS: set[int] = _parse_id_set("ADMIN_TELEGRAM_IDS")
# Support staff: READ-ONLY access to the admin surface (safe HTTP methods only).
# An id present in both sets is treated as a full admin.
SUPPORT_TELEGRAM_IDS: set[int] = _parse_id_set("SUPPORT_TELEGRAM_IDS")


def is_admin_tid(telegram_id: Optional[int]) -> bool:
    return bool(telegram_id) and int(telegram_id) in ADMIN_TELEGRAM_IDS


def is_support_tid(telegram_id: Optional[int]) -> bool:
    """True for support staff OR full admins (admins implicitly include support)."""
    return bool(telegram_id) and (
        int(telegram_id) in SUPPORT_TELEGRAM_IDS or int(telegram_id) in ADMIN_TELEGRAM_IDS
    )


# Logging -------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("lydomania")
