"""
Phase 6d — Case Battles engine (pure functions).

Provably-fair per-seat per-round item pick:
    item_index = weighted_pick(
        basket,
        HMAC_SHA256(server_seed, f"{battle_id}|{round_idx}|{seat_index}")
    )

Where weighted_pick maps a uniform-random value into a basket's cumulative
weight space — same primitive as the cases roller, just driven by HMAC
instead of os.urandom so any user can reproduce the result.

Modes:
    high_wins — player with highest TOTAL payout wins
    low_wins  — player with LOWEST  TOTAL payout wins

Ties → split equally among tied players (pot is conserved, net of rake).
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Iterable, Literal


Mode = Literal["high_wins", "low_wins"]
Status = Literal["open", "ready", "rolling", "completed", "cancelled"]

VALID_MODES: tuple[Mode, ...] = ("high_wins", "low_wins")
VALID_PLAYERS: tuple[int, ...] = (2, 3, 4)
MIN_CASES_PER_BATTLE = 2
MAX_CASES_PER_BATTLE = 6
HOUSE_RAKE_DEFAULT_PCT = 5.0
HOUSE_RAKE_MAX_PCT = 20.0

COUNTDOWN_SEC = 5.0
ROUND_REVEAL_SEC = 4.0


def derive_item_pick(
    basket: list[dict],
    server_seed: str,
    battle_id: str,
    round_idx: int,
    seat_index: int,
) -> tuple[int, str, float, str]:
    """Pick an item deterministically from `basket` using HMAC-SHA256.

    Returns (basket_index, slug, payout_ton, hmac_hex).
    Raises ValueError if basket is empty or weights sum to 0.
    """
    if not basket:
        raise ValueError("basket is empty")
    total_weight = sum(float(b.get("weight", 0)) for b in basket)
    if total_weight <= 0:
        raise ValueError("basket total weight is zero")

    msg = f"{battle_id}|{round_idx}|{seat_index}"
    h = hmac.new(server_seed.encode(), msg.encode(), hashlib.sha256).hexdigest()
    # 64-bit precision is plenty for baskets of <100 items
    u = int(h[:16], 16) / float(1 << 64)  # uniform in [0, 1)
    target = u * total_weight

    cum = 0.0
    for idx, b in enumerate(basket):
        cum += float(b.get("weight", 0))
        if target < cum:
            return idx, str(b["slug"]), float(b.get("payout_ton", 0)), h
    # Numerical edge case (target == total_weight) → last bucket
    last = basket[-1]
    return len(basket) - 1, str(last["slug"]), float(last.get("payout_ton", 0)), h


def compute_entry_ton(case_sequence_prices: Iterable[float]) -> float:
    return round(sum(float(p) for p in case_sequence_prices), 6)


def compute_pot_ton(entry_ton: float, players: int) -> float:
    return round(float(entry_ton) * int(players), 6)


def compute_payout_pool_ton(pot_ton: float, rake_pct: float) -> float:
    """Pot minus rake = pool to distribute to winners."""
    rake = max(0.0, min(HOUSE_RAKE_MAX_PCT, float(rake_pct)))
    return round(float(pot_ton) * (1.0 - rake / 100.0), 6)


def determine_winners(
    mode: Mode,
    seats_totals: list[tuple[int, float]],  # [(seat_index, total_payout)]
) -> list[int]:
    """Returns the list of winning seat indices (≥1 if tied)."""
    if not seats_totals:
        return []
    if mode == "high_wins":
        target = max(t for _, t in seats_totals)
    elif mode == "low_wins":
        target = min(t for _, t in seats_totals)
    else:
        raise ValueError(f"unknown mode {mode}")
    return [seat for seat, t in seats_totals if t == target]


def split_payout(payout_pool_ton: float, winners_count: int) -> float:
    """Pot is split evenly among ties. Last-cent rounding kept at 1 µTON."""
    if winners_count <= 0:
        return 0.0
    return round(float(payout_pool_ton) / int(winners_count), 6)


def validate_mode(mode: str) -> bool:
    return mode in VALID_MODES


def validate_players(n: int) -> bool:
    return int(n) in VALID_PLAYERS


def validate_case_sequence(slugs: list[str]) -> tuple[bool, str | None]:
    if not slugs:
        return False, "case_sequence cannot be empty"
    if len(slugs) < MIN_CASES_PER_BATTLE:
        return False, f"case_sequence must have ≥{MIN_CASES_PER_BATTLE} cases"
    if len(slugs) > MAX_CASES_PER_BATTLE:
        return False, f"case_sequence must have ≤{MAX_CASES_PER_BATTLE} cases"
    return True, None


def clamp_rake(rake_pct: float) -> float:
    return round(max(0.0, min(HOUSE_RAKE_MAX_PCT, float(rake_pct))), 2)
