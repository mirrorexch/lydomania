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


def _parse_admin_ids() -> set[int]:
    raw = os.environ.get("ADMIN_TELEGRAM_IDS", "").strip()
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


ADMIN_TELEGRAM_IDS: set[int] = _parse_admin_ids()


def is_admin_tid(telegram_id: Optional[int]) -> bool:
    return bool(telegram_id) and int(telegram_id) in ADMIN_TELEGRAM_IDS


# Logging -------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("lydomania")
