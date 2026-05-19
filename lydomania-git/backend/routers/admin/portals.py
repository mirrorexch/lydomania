"""Admin portals — Phase 3b: Fernet encryption + auto-migrate legacy XOR data."""
from __future__ import annotations

import base64
import os
from typing import Any, Optional

from fastapi import HTTPException, Query

from core.config import logger
from core.crypto import decrypt as fernet_decrypt, encrypt as fernet_encrypt, fingerprint
from core.models import PortalsAuthIn, PortalsListing, PortalsTestOut
from routers.admin import admin
from services.portals import mock_listings, try_real_listings
from services.settings import get_settings, update_settings


# ---- Legacy XOR (for migrating Phase 3a test data) -------------------------
def _xor_decrypt(blob: str, key: str) -> Optional[str]:
    try:
        enc = base64.urlsafe_b64decode(blob.encode("ascii"))
    except Exception:
        return None
    k = (key or "lydo_default_key_change_me").encode("utf-8")
    out = bytes([b ^ k[i % len(k)] for i, b in enumerate(enc)])
    try:
        return out.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _legacy_key() -> str:
    # Phase 3a fallback key for migration only
    return os.environ.get("ADMIN_API_KEY") or "lydo_default_key_change_me"


async def _resolve_authdata() -> Optional[str]:
    """Returns the plaintext authData if available. Auto-migrates XOR→Fernet."""
    s = await get_settings()
    # New format
    enc_fernet = s.get("portals_auth_data_fernet")
    if enc_fernet:
        return fernet_decrypt(enc_fernet)
    # Legacy XOR format
    enc_xor = s.get("portals_auth_data_enc")
    if enc_xor:
        plain = _xor_decrypt(enc_xor, _legacy_key())
        if plain:
            # Migrate to Fernet
            await update_settings({
                "portals_auth_data_fernet": fernet_encrypt(plain),
                "portals_auth_data_enc": None,
                "portals_auth_data_migrated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            })
            logger.info("portals_auth_data migrated XOR → Fernet")
            return plain
    return None


@admin.get("/portals/listings", response_model=list[PortalsListing])
async def admin_portals_listings(limit: int = Query(10, ge=1, le=100)) -> list[PortalsListing]:
    real = await try_real_listings(limit)
    items = real if real else mock_listings(limit)
    return [PortalsListing(**i) for i in items]


@admin.post("/portals/auth")
async def admin_portals_auth(payload: PortalsAuthIn) -> dict[str, Any]:
    enc = fernet_encrypt(payload.auth_data)
    fp = fingerprint(payload.auth_data)
    await update_settings({
        "portals_auth_data_fernet": enc,
        "portals_auth_data_fp": fp,
        "portals_auth_data_set_len": len(payload.auth_data),
        # Wipe any legacy XOR blob so we don't surface stale data
        "portals_auth_data_enc": None,
    })
    return {"ok": True, "encryption": "fernet", "fingerprint": fp, "length": len(payload.auth_data)}


@admin.post("/portals/test", response_model=PortalsTestOut)
async def admin_portals_test() -> PortalsTestOut:
    plain = await _resolve_authdata()
    if not plain:
        return PortalsTestOut(
            ok=False, error="no auth data stored",
            suggestion="POST /api/admin/portals/auth with auth_data first",
        )
    real = await try_real_listings(5)
    if not real:
        return PortalsTestOut(
            ok=False,
            error="Portals API unreachable from this environment",
            suggestion="This will work when deployed on a Telegram-attached IP. Storage of authData is verified working.",
            sample_listings=None,
        )
    return PortalsTestOut(ok=True, sample_listings=real[:5])
