"""Phase 7a — Crash (Rocket) engine: pure deterministic functions.

Crash-point derivation uses the **bustabit-style** formula, which is the de-facto
industry standard for provably-fair crash games and is well-studied.

    h = HMAC_SHA256(server_seed, round_id ":" client_seed_combined).hexdigest()
    if int(h, 16) % HOUSE_DIVISOR == 0:        # instant crash
        return 1.00
    e = int(h[:13], 16)                         # 52-bit unsigned int
    E = 2 ** 52
    raw = (100 * E - e) / (E - e)               # ∈ [100, +inf)
    crash = floor(raw) / 100                    # → 2 d.p.
    return max(1.00, crash)

HOUSE_DIVISOR = 12 ⇒ ~8.33% of rounds bust at exactly 1.00× (the house edge
sink). Realised RTP ≈ 1 − 1/12 ≈ 91.7%, within the 90-92% target band
(`tools/simulate_crash.py` verifies empirically).

Cashout payout is `floor(bet * x * 100) / 100` (truncate to 2 d.p.) when
`x < crash_multiplier`. Otherwise the bet is lost.
"""

from __future__ import annotations

import hashlib
import hmac
import math
from typing import Final

# ────────────────────────────────────────────────────────────────────────────
# Tunables (locked by spec)
# ────────────────────────────────────────────────────────────────────────────
HOUSE_DIVISOR: Final[int] = 12               # 1/12 ≈ 8.33% instant crashes → RTP ≈ 91.7% (target 90-92%)
MIN_BET_TON:  Final[float] = 0.1
MAX_BET_TON:  Final[float] = 200.0
MIN_AUTO_CASHOUT_X: Final[float] = 1.01
MAX_AUTO_CASHOUT_X: Final[float] = 1_000_000.0

# Round-state machine durations (seconds)
PHASE_DURATIONS_SEC: Final[dict[str, float]] = {
    "betting": 8.0,
    "crashed": 4.0,
}
# `running` phase has no fixed duration — it ends when the multiplier reaches `crash_multiplier`.

# Multiplier growth curve. We use `m(t) = exp(GROWTH_K * t)` so the rocket
# accelerates exponentially. At t = 7s we hit ~2.01×; t = 14s → ~4.06× etc.
# Calibration: GROWTH_K = ln(2.0) / 7  → multiplier doubles every 7 seconds.
GROWTH_K: Final[float] = math.log(2.0) / 7.0

# Server tick rate for WS broadcast & cashout precision.
TICK_HZ: Final[float] = 10.0
TICK_INTERVAL_SEC: Final[float] = 1.0 / TICK_HZ


# ────────────────────────────────────────────────────────────────────────────
# Provably-fair derivation
# ────────────────────────────────────────────────────────────────────────────
def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def derive_crash_multiplier(
    server_seed: str,
    round_id: str,
    client_seed_combined: str = "",
) -> float:
    """Pure: returns the crash multiplier (2 d.p.) for this round.

    The client_seed_combined is concatenated into the HMAC message so that
    aggregated player bets influence the outcome (commit-reveal). Defaults
    to empty for tests / sims where there are no real bets.
    """
    msg = f"{round_id}:{client_seed_combined}".encode()
    h = hmac.new(server_seed.encode(), msg, hashlib.sha256).hexdigest()
    # House-edge sink: ~1/HOUSE_DIVISOR rounds instant-crash at 1.00x.
    if int(h, 16) % HOUSE_DIVISOR == 0:
        return 1.00
    e = int(h[:13], 16)
    E = 1 << 52     # 2^52
    raw = (100 * E - e) / (E - e)
    crash = math.floor(raw) / 100.0
    return max(1.00, crash)


def multiplier_at(elapsed_sec: float) -> float:
    """Server's authoritative multiplier curve. Pure: depends only on elapsed."""
    if elapsed_sec <= 0:
        return 1.00
    return math.exp(GROWTH_K * elapsed_sec)


def elapsed_to_reach(target_x: float) -> float:
    """Inverse of `multiplier_at` — how many seconds to reach target_x."""
    if target_x <= 1.0:
        return 0.0
    return math.log(target_x) / GROWTH_K


def derive_client_seed_combined(bet_ids: list[str]) -> str:
    """Same shape as the Roulette helper — sorted hash of all bet IDs in the round."""
    if not bet_ids:
        return ""
    return sha256_hex("|".join(sorted(bet_ids)))


# ────────────────────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────────────────────
def validate_bet_amount(amount: float) -> tuple[bool, str | None]:
    if amount is None or amount != amount:                  # NaN guard
        return False, "amount_invalid"
    if amount < MIN_BET_TON - 1e-9:
        return False, f"min_bet_{MIN_BET_TON}"
    if amount > MAX_BET_TON + 1e-9:
        return False, f"max_bet_{MAX_BET_TON}"
    return True, None


def validate_auto_cashout(x: float | None) -> tuple[bool, str | None]:
    if x is None:
        return True, None
    if x < MIN_AUTO_CASHOUT_X - 1e-9:
        return False, f"min_auto_x_{MIN_AUTO_CASHOUT_X}"
    if x > MAX_AUTO_CASHOUT_X:
        return False, f"max_auto_x_{MAX_AUTO_CASHOUT_X}"
    return True, None


def compute_payout(bet_amount: float, cashout_x: float) -> float:
    """Truncate to 2 d.p. (favour the house on micro-rounding)."""
    raw = bet_amount * cashout_x
    return math.floor(raw * 100.0) / 100.0
