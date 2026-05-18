"""
Phase 6c — Roulette engine (pure functions).
Phase 6e — Bet tiers are FIXED to {1, 5, 25}; prizes are gifts (not TON × multiplier).

15-segment CSGO-style wheel.

    index 0  → green     (jackpot — basket of high-value gifts)
    odd 1..13 → red       (low — basket targeting ~2× tier in floor value)
    even 2..14 → black    (mid — same expected-value as red)

Provably-fair derivation (unchanged):
    segment_index = int(
        HMAC_SHA256(server_seed, client_seed_combined || round_id).hexdigest()[:8],
        16
    ) % 15

Phase 6e — winning-item derivation (new):
    For each winning bet on a (tier, color) basket of items with weights w_i,
    item_index = weighted_pick_from_hmac(
        HMAC_SHA256(server_seed, f"{round_id}|{bet_id}|item").hexdigest()
    )
    using cumulative-weight + 8-hex-prefix-mod-total_weight.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Literal

Color = Literal["red", "black", "green"]

WHEEL_SIZE = 15
GREEN_INDEX = 0
# DEPRECATED — kept for the legacy ROULETTE_PRIZE_MODE="ton" path.
PAYOUT = {"red": 2.0, "black": 2.0, "green": 14.0}
PHASE_DURATIONS_SEC = {
    "betting": 20.0,
    "locking": 2.0,
    "spinning": 8.0,
    "payout": 5.0,
}

# Phase 6e — fixed bet tiers (no open range)
BET_TIERS: tuple[float, ...] = (1.0, 5.0, 25.0)
BET_MIN_TON = BET_TIERS[0]   # kept so existing tests that import this still resolve
BET_MAX_TON = BET_TIERS[-1]
ROUND_DURATION_SEC = sum(PHASE_DURATIONS_SEC.values())


def color_for_index(i: int) -> Color:
    if not 0 <= i < WHEEL_SIZE:
        raise ValueError(f"segment index {i} out of range")
    if i == GREEN_INDEX:
        return "green"
    return "red" if (i % 2 == 1) else "black"


def wheel_layout() -> list[Color]:
    return [color_for_index(i) for i in range(WHEEL_SIZE)]


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def derive_client_seed_combined(bet_ids: list[str]) -> str:
    return sha256_hex("|".join(sorted(bet_ids)))


def derive_segment_index(server_seed: str, client_seed_combined: str, round_id: str) -> int:
    msg = f"{client_seed_combined}{round_id}".encode()
    h = hmac.new(server_seed.encode(), msg, hashlib.sha256).hexdigest()
    return int(h[:8], 16) % WHEEL_SIZE


def payout_multiplier(color: Color) -> float:
    """DEPRECATED in Phase 6e gift mode — kept for legacy/verifier symmetry."""
    return PAYOUT[color]


def validate_bet_tier(amount: float) -> tuple[bool, str | None]:
    """Phase 6e — only {1, 5, 25} TON tiers are accepted."""
    for t in BET_TIERS:
        if abs(amount - t) < 1e-9:
            return True, None
    return False, f"invalid_tier — must be one of {list(BET_TIERS)} TON"


def validate_bet_amount(amount: float) -> tuple[bool, str | None]:
    """Phase 6e — alias kept for back-compat callers; now enforces tier list."""
    return validate_bet_tier(amount)


def validate_color(color: str) -> bool:
    return color in PAYOUT


# ----- Phase 6e — weighted item picker (deterministic, provably-fair) ------

def derive_item_pick(
    server_seed: str, round_id: str, bet_id: str,
    basket_items: list[dict],
) -> dict:
    """Deterministic weighted pick from a (tier,color) basket.

    `basket_items` is a list of `{"item_slug": str, "weight": float}` dicts
    (order is canonicalised internally). The pick is reproducible from
    `(server_seed, round_id, bet_id)` alone.

    Returns the chosen `{"item_slug", "weight", "_index"}` dict.
    """
    if not basket_items:
        raise ValueError("empty basket")
    # canonicalise: sort by slug so DB ordering can't change the pick.
    ordered = sorted(basket_items, key=lambda b: b["item_slug"])
    weights = [max(0.0, float(b.get("weight") or 0.0)) for b in ordered]
    total = sum(weights)
    if total <= 0:
        raise ValueError("basket weights sum to zero")
    msg = f"{round_id}|{bet_id}|item".encode()
    h = hmac.new(server_seed.encode(), msg, hashlib.sha256).hexdigest()
    # 8 hex chars → 32-bit unsigned int → scale to [0, total)
    r = (int(h[:8], 16) / 0x100000000) * total
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if r < acc:
            chosen = dict(ordered[i])
            chosen["_index"] = i
            return chosen
    # FP fall-through guard
    chosen = dict(ordered[-1])
    chosen["_index"] = len(ordered) - 1
    return chosen
