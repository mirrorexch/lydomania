"""Phase 8 — Plinko tests."""
from __future__ import annotations

import secrets
from math import comb

import pytest

from core.db import users_col
from core.plinko_engine import (
    MULTIPLIERS, RISKS_ALLOWED, ROWS_ALLOWED, derive_path, expected_rtp,
    final_bucket, hash_server_seed, new_server_seed, verify_drop,
)
from core.time_utils import iso, now
from services.plinko import place_bet


# ── Pure engine ─────────────────────────────────────────────────────────────
def test_path_is_deterministic():
    a = derive_path("seedA", "client1", 12)
    b = derive_path("seedA", "client1", 12)
    assert a == b
    c = derive_path("seedB", "client1", 12)
    assert a != c


def test_path_length_matches_rows():
    for n in (4, 8, 12, 16, 20):
        path = derive_path("x", "y", n)
        assert len(path) == n
        assert all(b in (0, 1) for b in path)


def test_final_bucket_in_range():
    for n in ROWS_ALLOWED:
        path = derive_path("seed", "client", n)
        b = final_bucket(path)
        assert 0 <= b <= n


def test_expected_rtp_in_band_all_combos():
    """Every multiplier table should land in 0.92–1.00 (RTP band)."""
    for rows in ROWS_ALLOWED:
        for risk in RISKS_ALLOWED:
            rtp = expected_rtp(rows, risk)
            assert 0.92 <= rtp <= 1.02, (rows, risk, rtp)


def test_monte_carlo_matches_analytical_rtp():
    """Empirical RTP from 5000 drops should match the analytical RTP within 5%."""
    n = 12
    risk = "medium"
    analytical = expected_rtp(n, risk)
    paid = 0.0
    bet = 1.0
    n_drops = 5000
    seed_root = "monte:" + secrets.token_hex(4)
    for i in range(n_drops):
        path = derive_path(seed_root, f"client:{i}", n)
        bucket = final_bucket(path)
        mult = MULTIPLIERS[(n, risk)][bucket]
        paid += bet * mult
    empirical = paid / (n_drops * bet)
    # Allow ±10% wiggle for n=5000
    assert abs(empirical - analytical) / analytical < 0.10, (empirical, analytical)


def test_verify_drop_recomputes_correctly():
    seed = new_server_seed()
    sh = hash_server_seed(seed)
    path = derive_path(seed, "client", 8)
    bucket = final_bucket(path)
    mult = MULTIPLIERS[(8, "low")][bucket]
    v = verify_drop(seed, sh, "client", 8, "low", bucket, mult)
    assert v["server_seed_hash_matches"] is True
    assert v["bucket_matches"] is True
    assert v["multiplier_matches"] is True


def test_verify_detects_tampered_hash():
    seed = new_server_seed()
    sh_fake = "0" * 64
    path = derive_path(seed, "client", 8)
    bucket = final_bucket(path)
    mult = MULTIPLIERS[(8, "low")][bucket]
    v = verify_drop(seed, sh_fake, "client", 8, "low", bucket, mult)
    assert v["server_seed_hash_matches"] is False


# ── Service ────────────────────────────────────────────────────────────────
async def _user(balance: float = 100.0):
    uid = secrets.token_hex(12)
    tid = secrets.randbelow(10_000_000_000) + 90_000_000_000
    await users_col.insert_one({
        "id": uid, "telegram_id": tid, "username": f"p{tid}",
        "balance_ton": float(balance),
        "created_at": iso(now()), "updated_at": iso(now()),
    })
    return uid


@pytest.mark.asyncio
async def test_place_bet_debits_and_credits():
    uid = await _user(balance=10.0)
    res = await place_bet(uid, 1.0, 8, "medium")
    assert "bet_id" in res
    assert res["bet_ton"] == 1.0
    # balance after = 10 - 1 (debit) + payout
    expected = 10.0 - 1.0 + float(res["payout_ton"])
    assert abs(res["new_balance_ton"] - expected) < 1e-6


@pytest.mark.asyncio
async def test_place_bet_insufficient_balance():
    from core.plinko_engine import PlinkoError
    uid = await _user(balance=0.5)
    with pytest.raises(PlinkoError) as ei:
        await place_bet(uid, 5.0, 8, "low")
    assert "insufficient_balance" in str(ei.value)


@pytest.mark.asyncio
async def test_place_bet_invalid_combo():
    from core.plinko_engine import PlinkoError
    uid = await _user(balance=10.0)
    with pytest.raises(PlinkoError):
        await place_bet(uid, 1.0, 7, "low")    # rows=7 not in ROWS_ALLOWED
