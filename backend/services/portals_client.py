"""
Phase 4b — Portals marketplace client abstraction.

Two implementations:
  • MockPortalsClient — deterministic fake listings + simulated purchase.
    Used in tests, dev-mode sandbox, and any time `settings.portals_client_mode == "mock"`.
  • RealPortalsClient — real HTTP calls to portals-market.com using
    stored Fernet-encrypted authData. Active when `portals_client_mode == "real"`.

Both share the abstract `PortalsClient` interface so callers (auto_fulfill,
admin tools) can swap implementations without code changes.
"""
from __future__ import annotations

import asyncio
import json
import secrets
from typing import Any, Optional, Protocol

import httpx

from core.config import logger
from core.crypto import decrypt as decrypt_text
from services.settings import get_settings


class PortalsClient(Protocol):
    async def list_for_slug(self, slug: str, limit: int = 5) -> list[dict[str, Any]]: ...
    async def cheapest_for_slug(self, slug: str, max_price_ton: Optional[float] = None) -> Optional[dict[str, Any]]: ...
    async def purchase(self, listing: dict[str, Any]) -> dict[str, Any]: ...
    async def confirm_received(self, purchase: dict[str, Any], timeout_s: int = 60) -> dict[str, Any]: ...


# ---------- MOCK ----------

class MockPortalsClient:
    """Deterministic fake client. Always succeeds (configurable failure rate)."""

    def __init__(self, *, fail_rate: float = 0.0, sim_delay_s: float = 0.1):
        self.fail_rate = float(fail_rate)
        self.sim_delay_s = float(sim_delay_s)

    async def list_for_slug(self, slug: str, limit: int = 5) -> list[dict[str, Any]]:
        await asyncio.sleep(self.sim_delay_s)
        # Deterministic per-slug seed scaled to "cheap-ish" listings (1-10 TON base).
        seed = sum(ord(c) for c in slug)
        rng_base = (seed % 10) + 1  # 1..10
        step = 0.5 + ((seed % 7) / 5.0)  # 0.5..2.0
        return [
            {
                "listing_id": f"mock-{slug}-{i}",
                "slug": slug,
                "name": slug.replace("_", " ").title(),
                "price_ton": round(rng_base + i * step, 2),
                "nft_address": f"EQMock{secrets.token_hex(6)}{i:02d}",
                "source": "mock",
            }
            for i in range(limit)
        ]

    async def cheapest_for_slug(self, slug: str, max_price_ton: Optional[float] = None) -> Optional[dict[str, Any]]:
        rows = await self.list_for_slug(slug, limit=3)
        if not rows:
            return None
        cheapest = min(rows, key=lambda r: r["price_ton"])
        if max_price_ton is not None and cheapest["price_ton"] > max_price_ton:
            return None
        return cheapest

    async def purchase(self, listing: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(self.sim_delay_s)
        if self.fail_rate > 0 and secrets.randbelow(1000) / 1000.0 < self.fail_rate:
            return {"ok": False, "error": "mock_random_failure", "listing_id": listing.get("listing_id")}
        return {
            "ok": True,
            "purchase_id": f"mock-purchase-{secrets.token_hex(8)}",
            "listing_id": listing.get("listing_id"),
            "nft_address": listing.get("nft_address"),
            "spent_ton": float(listing.get("price_ton") or 0),
            "tx_hash": f"mock-tx-{secrets.token_hex(16)}",
            "source": "mock",
        }

    async def confirm_received(self, purchase: dict[str, Any], timeout_s: int = 60) -> dict[str, Any]:
        await asyncio.sleep(self.sim_delay_s)
        return {
            "ok": True,
            "nft_address": purchase.get("nft_address"),
            "owner": "vault",
            "confirmed_at": "mock",
        }


# ---------- REAL ----------

class RealPortalsClient:
    """HTTP client for portals-market.com.

    NOTE: The actual purchase flow on portals-market.com is interactive
    (it returns an escrow address and you send TON externally). This wrapper
    implements `list_for_slug` (verified) and stubs purchase/confirm with
    placeholder logic that mirrors the documented Portals flow. If the user
    flips `portals_client_mode=real`, auto-fulfill remains gated by
    `auto_fulfill_dry_run=true` until the real flow is end-to-end tested
    against the production marketplace.
    """

    BASE = "https://portals-market.com/api"

    def __init__(self, auth_data: Optional[str] = None, timeout_s: float = 10.0):
        self.auth_data = auth_data
        self.timeout = timeout_s

    def _headers(self) -> dict[str, str]:
        h = {"User-Agent": "Lydomania/0.2", "Accept": "application/json"}
        if self.auth_data:
            h["Authorization"] = f"tma {self.auth_data}"
        return h

    async def list_for_slug(self, slug: str, limit: int = 5) -> list[dict[str, Any]]:
        # The Portals public listing endpoints return mixed data; we attempt the
        # documented collections endpoint and degrade gracefully.
        try:
            async with httpx.AsyncClient(timeout=self.timeout, headers=self._headers()) as cli:
                r = await cli.get(f"{self.BASE}/collections", params={"limit": 200, "offset": 0})
            if r.status_code != 200:
                return []
            try:
                j = r.json()
            except json.JSONDecodeError:
                return []
            cols = j.get("collections") or j.get("data") or (j if isinstance(j, list) else [])
            out: list[dict[str, Any]] = []
            for c in cols if isinstance(cols, list) else []:
                if not isinstance(c, dict):
                    continue
                name = (c.get("name") or c.get("title") or "").lower().replace(" ", "_")
                if slug not in name:
                    continue
                out.append({
                    "listing_id": str(c.get("id") or c.get("slug") or name),
                    "slug": slug,
                    "name": c.get("name") or slug,
                    "price_ton": float(c.get("floor_price") or c.get("price") or 0),
                    "nft_address": c.get("address") or c.get("nft_address"),
                    "source": "portals",
                })
                if len(out) >= limit:
                    break
            return out
        except Exception as e:
            logger.warning("RealPortals.list_for_slug failed: %s", e)
            return []

    async def cheapest_for_slug(self, slug: str, max_price_ton: Optional[float] = None) -> Optional[dict[str, Any]]:
        rows = [r for r in await self.list_for_slug(slug, limit=10) if (r.get("price_ton") or 0) > 0]
        if not rows:
            return None
        cheapest = min(rows, key=lambda r: r["price_ton"])
        if max_price_ton is not None and cheapest["price_ton"] > max_price_ton:
            return None
        return cheapest

    async def purchase(self, listing: dict[str, Any]) -> dict[str, Any]:
        # STUB — Portals doesn't expose a public buy API; in production, the
        # operator would replace this with a signed-intent flow or fall back to
        # admin manual queue when the order cannot be auto-bought.
        return {
            "ok": False,
            "error": "real_purchase_not_implemented",
            "listing_id": listing.get("listing_id"),
            "hint": "use admin manual queue or set portals_client_mode=mock for sandbox",
        }

    async def confirm_received(self, purchase: dict[str, Any], timeout_s: int = 60) -> dict[str, Any]:
        return {"ok": False, "error": "real_confirm_not_implemented"}


# ---------- factory ----------

async def get_portals_client() -> PortalsClient:
    """Resolve the active client based on settings."""
    settings = await get_settings()
    mode = (settings.get("portals_client_mode") or "mock").lower()
    if mode == "real":
        encrypted = settings.get("portals_auth_data_encrypted")
        auth = decrypt_text(encrypted) if encrypted else None
        return RealPortalsClient(auth_data=auth)
    return MockPortalsClient(
        fail_rate=float(settings.get("mock_portals_fail_rate") or 0.0),
        sim_delay_s=float(settings.get("mock_portals_sim_delay_s") or 0.05),
    )
