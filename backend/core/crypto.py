"""Fernet symmetric encryption for sensitive settings (Phase 3b)."""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


def _key_bytes() -> bytes:
    raw = os.environ.get("SETTINGS_ENCRYPTION_KEY", "").strip()
    if raw:
        return raw.encode("utf-8")

    # SECURITY: never fall back to a hardcoded key. On mainnet this MUST be set
    # explicitly or we refuse to boot — a predictable key means encrypted settings
    # are trivially decryptable by anyone who can read the source.
    if os.environ.get("TON_NETWORK", "").strip().lower() == "mainnet":
        raise RuntimeError(
            "SETTINGS_ENCRYPTION_KEY is required on mainnet. Generate one with "
            "Fernet.generate_key() and set it in the environment."
        )

    # Non-mainnet (dev/testnet): derive an ephemeral key from JWT_SECRET so local
    # work needs no extra setup. Still no hardcoded default — JWT_SECRET must exist.
    seed = os.environ.get("JWT_SECRET", "").strip()
    if not seed:
        raise RuntimeError(
            "Set SETTINGS_ENCRYPTION_KEY (or at least JWT_SECRET for non-mainnet) — "
            "no fallback encryption key is permitted."
        )
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_key_bytes())


def encrypt(plain: str) -> str:
    return _fernet.encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(blob: str) -> Optional[str]:
    try:
        return _fernet.decrypt(blob.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def fingerprint(plain: str, length: int = 16) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()[:length]
