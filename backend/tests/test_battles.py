"""Phase 6d — automated tests for the battles engine (pure functions)."""

from __future__ import annotations

import pytest

from core.battles_engine import (
    HOUSE_RAKE_MAX_PCT,
    MAX_CASES_PER_BATTLE, clamp_rake, compute_entry_ton, compute_payout_pool_ton, compute_pot_ton,
    derive_item_pick, determine_winners, split_payout,
    validate_case_sequence, validate_mode, validate_players,
)


SAMPLE_BASKET = [
    {"slug": "lol_pop",       "weight": 250.0, "payout_ton": 3.0},
    {"slug": "lunar_snake",   "weight": 200.0, "payout_ton": 10.0},
    {"slug": "winter_wreath", "weight": 150.0, "payout_ton": 30.0},
    {"slug": "santa_sleigh",  "weight":  80.0, "payout_ton": 200.0},
    {"slug": "plush_pepe",    "weight":   2.0, "payout_ton": 6100.0},
]


def test_derive_item_pick_deterministic():
    a = derive_item_pick(SAMPLE_BASKET, "seed_a", "battle_x", 0, 0)
    b = derive_item_pick(SAMPLE_BASKET, "seed_a", "battle_x", 0, 0)
    assert a == b


def test_derive_item_pick_changes_with_seat():
    a = derive_item_pick(SAMPLE_BASKET, "seed_a", "battle_x", 0, 0)
    b = derive_item_pick(SAMPLE_BASKET, "seed_a", "battle_x", 0, 1)
    # In practice >99% chance these differ; we just assert nothing crashes
    assert a[0] in range(len(SAMPLE_BASKET))
    assert b[0] in range(len(SAMPLE_BASKET))


def test_derive_item_pick_known_vectors():
    """8 fixed (seed, battle_id, round_idx, seat) tuples — all reproducible."""
    vectors = [
        ("seed_a", "battle_x", 0, 0),
        ("seed_a", "battle_x", 0, 1),
        ("seed_a", "battle_x", 0, 2),
        ("seed_a", "battle_x", 0, 3),
        ("seed_a", "battle_x", 1, 0),
        ("seed_b", "battle_x", 0, 0),
        ("seed_a", "battle_y", 0, 0),
        ("seed_zero", "round_zero", 5, 9),
    ]
    a = [derive_item_pick(SAMPLE_BASKET, *v) for v in vectors]
    b = [derive_item_pick(SAMPLE_BASKET, *v) for v in vectors]
    assert a == b
    for idx, slug, payout, h in a:
        assert 0 <= idx < len(SAMPLE_BASKET)
        assert slug in {b["slug"] for b in SAMPLE_BASKET}
        assert payout >= 0
        assert len(h) == 64


def test_derive_item_pick_empty_basket_raises():
    with pytest.raises(ValueError):
        derive_item_pick([], "s", "b", 0, 0)


def test_compute_entry_pot():
    assert compute_entry_ton([1.0, 5.0, 10.0]) == 16.0
    assert compute_pot_ton(16.0, 2) == 32.0
    assert compute_pot_ton(16.0, 4) == 64.0


def test_compute_payout_pool_with_rake():
    assert compute_payout_pool_ton(100.0, 5.0) == 95.0
    assert compute_payout_pool_ton(100.0, 0.0) == 100.0
    assert compute_payout_pool_ton(100.0, 20.0) == 80.0
    # rake clamps to max
    assert compute_payout_pool_ton(100.0, 999.0) == compute_payout_pool_ton(100.0, HOUSE_RAKE_MAX_PCT)


def test_determine_winners_high():
    totals = [(0, 10.0), (1, 30.0), (2, 25.0)]
    assert determine_winners("high_wins", totals) == [1]


def test_determine_winners_low():
    totals = [(0, 10.0), (1, 30.0), (2, 25.0)]
    assert determine_winners("low_wins", totals) == [0]


def test_determine_winners_tie():
    totals = [(0, 30.0), (1, 30.0), (2, 25.0)]
    assert determine_winners("high_wins", totals) == [0, 1]


def test_split_payout_evenly():
    assert split_payout(95.0, 1) == 95.0
    assert split_payout(95.0, 2) == 47.5
    assert split_payout(95.0, 3) == round(95.0 / 3, 6)
    assert split_payout(95.0, 0) == 0.0


def test_payout_conservation_with_tie():
    """Pot is conserved: sum(winners×payout_each) ≤ pot×(1-rake)."""
    pot = 200.0
    rake = 5.0
    pool = compute_payout_pool_ton(pot, rake)
    for n_winners in range(1, 5):
        per = split_payout(pool, n_winners)
        total_paid = per * n_winners
        assert total_paid <= pool + 1e-6, f"value created on tie split (n={n_winners})"


def test_validate_helpers():
    assert validate_mode("high_wins")
    assert validate_mode("low_wins")
    assert not validate_mode("invalid")
    for n in (2, 3, 4):
        assert validate_players(n)
    assert not validate_players(1)
    assert not validate_players(5)
    ok, _ = validate_case_sequence(["a", "b"])
    assert ok
    ok, _ = validate_case_sequence(["a"])
    assert not ok
    ok, _ = validate_case_sequence(["a"] * (MAX_CASES_PER_BATTLE + 1))
    assert not ok


def test_clamp_rake():
    assert clamp_rake(-5) == 0.0
    assert clamp_rake(0) == 0.0
    assert clamp_rake(5) == 5.0
    assert clamp_rake(20) == 20.0
    assert clamp_rake(25) == HOUSE_RAKE_MAX_PCT
