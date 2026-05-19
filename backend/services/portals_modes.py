"""Phase 9 — Portals on-chain auto-fulfill mode guard.

Three modes:
   mock     — current behaviour, no on-chain side-effects (sandbox default).
   dry_run  — build real signed messages but DO NOT broadcast. Persist them
              for audit. Useful for shadow-launches.
   live     — broadcast signed messages via Tonapi. PRODUCTION ONLY.

Safety caps (env-driven, lifted from spec):
   PORTALS_DAILY_CAP_TON    (default 10)
   PORTALS_PER_TX_CAP_TON   (default 5)
   PORTALS_HOT_WALLET_MNEMONIC — required for `live`, optional otherwise.

API:
   get_mode()                    -> "mock" | "dry_run" | "live"
   validate_startup_safety()     -> raises RuntimeError if misconfigured
   is_within_per_tx_cap(amount)  -> bool
   is_within_daily_cap(daily)    -> bool
"""
from __future__ import annotations

import os
from typing import Final

VALID_MODES: Final[tuple[str, ...]] = ("mock", "dry_run", "live")


class PortalsConfigError(RuntimeError):
    """Surface as a 500 if misconfigured; raise at startup before serving."""


def get_mode() -> str:
    raw = (os.environ.get("PORTALS_MODE") or "mock").strip().lower()
    if raw not in VALID_MODES:
        raise PortalsConfigError(f"invalid_PORTALS_MODE:{raw}")
    return raw


def get_daily_cap_ton() -> float:
    try:
        return float(os.environ.get("PORTALS_DAILY_CAP_TON", "10"))
    except ValueError:
        return 10.0


def get_per_tx_cap_ton() -> float:
    try:
        return float(os.environ.get("PORTALS_PER_TX_CAP_TON", "5"))
    except ValueError:
        return 5.0


def get_hot_wallet_mnemonic() -> str | None:
    v = os.environ.get("PORTALS_HOT_WALLET_MNEMONIC")
    return v.strip() if v else None


def validate_startup_safety() -> None:
    """Raise BEFORE the app accepts traffic if config is unsafe.

    The biggest footgun is enabling `live` without a hot-wallet mnemonic,
    which would crash the broadcast path with a confusing KeyError far away
    from the misconfiguration. We catch it here.
    """
    mode = get_mode()
    if mode == "live" and not get_hot_wallet_mnemonic():
        raise PortalsConfigError(
            "PORTALS_MODE=live requires PORTALS_HOT_WALLET_MNEMONIC to be set.",
        )
    if get_per_tx_cap_ton() <= 0:
        raise PortalsConfigError("PORTALS_PER_TX_CAP_TON must be > 0")
    if get_daily_cap_ton() <= 0:
        raise PortalsConfigError("PORTALS_DAILY_CAP_TON must be > 0")


def is_within_per_tx_cap(amount_ton: float) -> bool:
    return amount_ton <= get_per_tx_cap_ton()


def is_within_daily_cap(rolling_24h_total_ton: float) -> bool:
    return rolling_24h_total_ton <= get_daily_cap_ton()


def safe_to_auto_fulfill(amount_ton: float, rolling_24h_total_ton: float) -> bool:
    """Anything above either cap stays in the manual queue."""
    return is_within_per_tx_cap(amount_ton) and is_within_daily_cap(
        rolling_24h_total_ton + amount_ton,
    )
