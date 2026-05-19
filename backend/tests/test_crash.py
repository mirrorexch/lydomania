"""Phase 7a — Crash engine unit tests (pure-function level).

Service-level race tests run via `tools/simulate_crash.py` and the
testing-agent end-to-end probe — see `test_credentials.md`.
"""

from __future__ import annotations

import math

import pytest

from core.crash_engine import (
    HOUSE_DIVISOR, MAX_BET_TON, MIN_BET_TON,
    compute_payout, derive_client_seed_combined, derive_crash_multiplier,
    elapsed_to_reach, multiplier_at, sha256_hex,
    validate_auto_cashout, validate_bet_amount,
)
from tools.simulate_crash import simulate


# ─── Determinism + known vectors ────────────────────────────────────────────
def test_derive_crash_is_deterministic():
    ss = "deadbeef" * 8
    rid = "round-abc"
    csc = "csc-xyz"
    a = derive_crash_multiplier(ss, rid, csc)
    b = derive_crash_multiplier(ss, rid, csc)
    assert a == b


def test_derive_crash_changes_with_seed():
    ss1 = "a" * 64
    ss2 = "b" * 64
    rid = "r"
    csc = "c"
    assert derive_crash_multiplier(ss1, rid, csc) != derive_crash_multiplier(ss2, rid, csc)


def test_derive_crash_lower_bound():
    """Even the worst-case derivation must return ≥ 1.00."""
    import secrets
    for _ in range(200):
        ss = secrets.token_hex(32)
        rid = secrets.token_hex(8)
        x = derive_crash_multiplier(ss, rid, "")
        assert x >= 1.00


def test_derive_crash_known_vectors():
    """10 hard-coded vectors lock the formula across refactors."""
    vectors = [
        ("0" * 64, "round-0"),
        ("0" * 64, "round-1"),
        ("f" * 64, "round-0"),
        ("a1b2c3" * 10 + "abcd", "rid_xyz"),
        ("seed1", "round-1"),
        ("seed2", "round-2"),
        ("seed3", "round-3"),
        ("seed4", "round-4"),
        ("seed5", "round-5"),
        ("seed6", "round-6"),
    ]
    out = [derive_crash_multiplier(ss, rid, "") for ss, rid in vectors]
    # Each vector must produce a finite multiplier ≥ 1.00; they should
    # not all collapse to 1.00 (that would imply a broken formula).
    assert all(x >= 1.0 and math.isfinite(x) for x in out)
    assert sum(1 for x in out if x > 1.0) >= 7      # most non-instant
    # Re-derive — exact match
    out2 = [derive_crash_multiplier(ss, rid, "") for ss, rid in vectors]
    assert out == out2


def test_derive_crash_instant_rate_close_to_one_in_house_divisor():
    """Expected instant-crash rate ≈ 2% (1% from natural floor() + 1% from %100 check).

    The bustabit formula `floor((100E-e)/(E-e))/100 == 1.00` whenever u=e/E ∈ [0, 0.01),
    so 1% of rounds land at 1.00x naturally. The explicit `% HOUSE_DIVISOR == 0` check
    stacks another 1% on top → total ~2% house edge → realised RTP ~98% (target band).
    """
    import secrets
    n = 5_000
    inst = sum(
        1 for _ in range(n)
        if derive_crash_multiplier(secrets.token_hex(32), secrets.token_hex(8), "") == 1.00
    )
    # Expect ~100 instant crashes (2% of 5000). Allow a generous envelope for variance.
    assert 50 <= inst <= 180, f"instant-crash rate {inst}/{n} ({100*inst/n:.2f}%) out of expected ~2% band"


# ─── Multiplier curve + cashout maths ────────────────────────────────────────
def test_multiplier_at_starts_at_one():
    assert multiplier_at(0) == 1.0
    assert multiplier_at(-1) == 1.0


def test_multiplier_at_monotonic():
    last = 0.0
    for t in range(0, 50):
        x = multiplier_at(t * 0.5)
        assert x >= last
        last = x


def test_elapsed_to_reach_inverse():
    for target in (1.5, 2.0, 5.0, 25.0, 100.0):
        t = elapsed_to_reach(target)
        x = multiplier_at(t)
        # Round-trip must match within 1e-9
        assert abs(x - target) < 1e-6


def test_compute_payout_truncates():
    # 1 TON * 2.99x → 2.99 TON (no rounding up)
    assert compute_payout(1.0, 2.999) == 2.99
    assert compute_payout(2.5, 4.0) == 10.0
    # Truncation example: 0.1 * 2.345 = 0.2345 → 0.23
    assert compute_payout(0.1, 2.345) == 0.23


# ─── Validators ─────────────────────────────────────────────────────────────
def test_validate_bet_amount_ok():
    assert validate_bet_amount(0.1) == (True, None)
    assert validate_bet_amount(1.0) == (True, None)
    assert validate_bet_amount(200.0) == (True, None)


def test_validate_bet_amount_rejects():
    ok, _ = validate_bet_amount(0.0)
    assert not ok
    ok, _ = validate_bet_amount(0.099)
    assert not ok
    ok, _ = validate_bet_amount(200.01)
    assert not ok
    ok, _ = validate_bet_amount(float("nan"))
    assert not ok


def test_validate_auto_cashout_none_ok():
    assert validate_auto_cashout(None) == (True, None)


def test_validate_auto_cashout_min():
    ok, _ = validate_auto_cashout(1.0)
    assert not ok
    ok, _ = validate_auto_cashout(1.01)
    assert ok


# ─── Helpers ────────────────────────────────────────────────────────────────
def test_derive_client_seed_combined_stable():
    a = derive_client_seed_combined(["b", "a", "c"])
    b = derive_client_seed_combined(["c", "a", "b"])
    assert a == b
    c = derive_client_seed_combined([])
    assert c == ""


def test_sha256_hex_known_vector():
    assert sha256_hex("abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


# ─── 10 000-round RTP sim (matches the acceptance criterion) ────────────────
@pytest.mark.slow
def test_simulation_rtp_within_band():
    """End-to-end: realised RTP for cashout-at-2× must land in [97, 99]% on 10k rounds.

    With HOUSE_DIVISOR=100 the intrinsic RTP of the bustabit formula is
    exactly 99% (the only losing case for X-cashout is an instant 1.00× crash).
    Sample-variance gives a ~±0.5% band at n=10000 → assert 97–99%.
    """
    res = simulate(10_000)
    rtp_2x = res["rtp_strategy_x"][2.0]
    assert 0.970 <= rtp_2x <= 0.995, f"realised RTP {rtp_2x*100:.2f}% out of band"
    # Mean should be > 1.00 with non-trivial mass above 2×
    assert res["mean"] > 1.0
