"""Fernet symmetric encryption for sensitive settings (Phase 3b)."""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


def _key_bytes() -> bytes:
    raw = os.environ.get("SETTINGS_ENCRYPTION_KEY", "").strip()
    if not raw:
        # Last-resort deterministic key derived from JWT_SECRET — better than crashing,
        # but the env var should always be set in production.
        seed = os.environ.get("JWT_SECRET", "lydomania_default_fallback_key")
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)
    return raw.encode("utf-8")


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
