"""
Lydomania game core — provably-fair RNG (commit-reveal) and case-open logic.

Algorithm:
  roll_hash = HMAC_SHA256(server_seed, f"{client_seed}:{nonce}")
  roll_int  = int(roll_hash[:13], 16)
  roll_float = roll_int / 16**13      -> uniform in [0, 1)
  pick item with cumulative weight CDF
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Iterable, Optional


HEX_WINDOW = 13       # chars taken from HMAC hex digest
MAX_FLOAT = 16 ** HEX_WINDOW  # denominator -> uniform [0,1)


def gen_server_seed() -> tuple[str, str]:
    """Returns (server_seed_hex, server_seed_hash)."""
    seed = secrets.token_hex(32)  # 64 hex chars
    seed_hash = hashlib.sha256(seed.encode()).hexdigest()
    return seed, seed_hash


def hash_server_seed(seed: str) -> str:
    """SHA-256 hex digest of a server seed (used to recompute pre-roll commit)."""
    return hashlib.sha256(seed.encode()).hexdigest()


def gen_client_seed() -> str:
    """A reasonable default client seed if user does not provide one."""
    return secrets.token_hex(16)


def compute_roll(server_seed: str, client_seed: str, nonce: int) -> tuple[str, float]:
    """
    Returns (roll_hash_full_hex, roll_float in [0,1)).
    """
    message = f"{client_seed}:{nonce}".encode()
    digest = hmac.new(server_seed.encode(), message, hashlib.sha256).hexdigest()
    roll_int = int(digest[:HEX_WINDOW], 16)
    return digest, roll_int / MAX_FLOAT


def pick_winner(
    roll_float: float,
    basket: Iterable[dict],  # each: {slug, weight, payout_ton, ...}
) -> dict:
    """
    Map a uniform float in [0,1) to a basket entry via cumulative weights.
    The basket items must include 'weight' field (positive numbers).
    Returns the chosen entry (the same dict reference).
    """
    items = list(basket)
    total = sum(float(it["weight"]) for it in items)
    if total <= 0:
        raise ValueError("basket has zero total weight")
    target = roll_float * total
    acc = 0.0
    for it in items:
        acc += float(it["weight"])
        if target < acc:
            return it
    return items[-1]  # numerical edge


# ---------------------------------------------------------------------------
# Calibration helper (used by seed script)
# ---------------------------------------------------------------------------
def compute_basket_ev(basket: Iterable[dict]) -> float:
    """EV in TON across the entire basket (no rotation, no jackpot logic)."""
    items = list(basket)
    total_w = sum(float(it["weight"]) for it in items)
    if total_w <= 0:
        return 0.0
    return sum(float(it["weight"]) * float(it["payout_ton"]) for it in items) / total_w


def solve_jackpot_weight(
    base_basket: list[dict],
    jackpot_payout: float,
    target_ev: float,
) -> Optional[float]:
    """
    Given base basket (without the jackpot item appended) and a target EV (TON),
    return the weight to assign to the jackpot item to land exactly on target.

    EV = (A + w_j * p_j) / (B + w_j) = T
       w_j = (T*B - A) / (p_j - T)

    Returns None if no positive solution exists.
    """
    a = sum(float(it["weight"]) * float(it["payout_ton"]) for it in base_basket)
    b = sum(float(it["weight"]) for it in base_basket)
    denom = jackpot_payout - target_ev
    if denom <= 0:
        return None
    w_j = (target_ev * b - a) / denom
    if w_j <= 0:
        return None
    return w_j
