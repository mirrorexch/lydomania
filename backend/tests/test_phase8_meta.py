"""Phase 8 — Activity + Achievements tests."""
from __future__ import annotations

import secrets

import pytest

from core.achievements_catalog import CATALOG, by_id, evaluate_progress
from core.db import users_col
from core.time_utils import iso, now
from services.achievements import (
    AchievementError, claim, evaluate_after, list_for_user,
)
from services.activity import _anonymize, maybe_broadcast, recent


# ── Catalog ──────────────────────────────────────────────────────────────
def test_catalog_has_15_unique_entries():
    assert len(CATALOG) == 15
    ids = [a["achievement_id"] for a in CATALOG]
    assert len(set(ids)) == len(ids)


def test_evaluate_progress_single():
    crit = {"kind": "single", "source": "wheel_spin"}
    assert evaluate_progress(crit, {}) == (False, 0, 1)
    assert evaluate_progress(crit, {"wheel_spin": 1}) == (True, 1, 1)


def test_evaluate_progress_counter():
    crit = {"kind": "counter", "source": "case_open", "target": 50}
    assert evaluate_progress(crit, {"case_open": 49}) == (False, 49, 50)
    assert evaluate_progress(crit, {"case_open": 50}) == (True, 50, 50)
    assert evaluate_progress(crit, {"case_open": 999}) == (True, 50, 50)


async def _user():
    uid = secrets.token_hex(12)
    tid = secrets.randbelow(10_000_000_000) + 90_000_000_000
    await users_col.insert_one({
        "id": uid, "telegram_id": tid, "username": f"a{tid}",
        "balance_ton": 100.0, "free_spin_tokens": 0,
        "created_at": iso(now()), "updated_at": iso(now()),
    })
    return uid


# ── Achievements service ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_evaluate_after_unlocks_first_spin():
    uid = await _user()
    unlocked = await evaluate_after(uid, "wheel_spin", amount_ton=1.0)
    assert "first_spin" in unlocked


@pytest.mark.asyncio
async def test_evaluate_after_idempotent_unlock():
    uid = await _user()
    a = await evaluate_after(uid, "wheel_spin")
    b = await evaluate_after(uid, "wheel_spin")
    # Second call shouldn't re-emit
    assert "first_spin" in a
    assert "first_spin" not in b


@pytest.mark.asyncio
async def test_evaluate_after_counter_unlock_at_target():
    uid = await _user()
    seen_unlock = False
    for i in range(50):
        unlocked = await evaluate_after(uid, "case_open")
        if "open_50_cases" in unlocked:
            seen_unlock = True
            break
    assert seen_unlock


@pytest.mark.asyncio
async def test_evaluate_after_big_multiplier():
    uid = await _user()
    u = await evaluate_after(uid, "plinko_drop", multiplier=10.0, payout_ton=5.0)
    assert "hit_5x_multiplier" in u
    u = await evaluate_after(uid, "plinko_drop", multiplier=80.0, payout_ton=100.0)
    assert "hit_50x_multiplier" in u


@pytest.mark.asyncio
async def test_claim_grants_reward():
    uid = await _user()
    await evaluate_after(uid, "wheel_spin")
    r = await claim(uid, "first_spin")
    assert r["achievement_id"] == "first_spin"
    with pytest.raises(AchievementError):
        await claim(uid, "first_spin")


@pytest.mark.asyncio
async def test_claim_not_unlocked():
    uid = await _user()
    with pytest.raises(AchievementError) as ei:
        await claim(uid, "first_spin")
    assert "not_unlocked" in str(ei.value)


@pytest.mark.asyncio
async def test_list_for_user_includes_progress():
    uid = await _user()
    await evaluate_after(uid, "wheel_spin")
    rows = await list_for_user(uid)
    fs = next(a for a in rows if a["achievement_id"] == "first_spin")
    assert fs["unlocked"] is True
    assert fs["progress"] == 1


# ── Activity ────────────────────────────────────────────────────────────
def test_anonymize_username():
    assert _anonymize("alice", None) == "alic…"
    assert _anonymize("ab", None) == "ab"
    assert _anonymize(None, 123456789) == "u1234"


@pytest.mark.asyncio
async def test_maybe_broadcast_skips_small_wins():
    uid = await _user()
    r = await maybe_broadcast(uid, game="plinko", kind="plinko_drop",
                              payout_ton=1.0, multiplier=2.0)
    assert r is None  # below thresholds


@pytest.mark.asyncio
async def test_maybe_broadcast_persists_big_wins():
    uid = await _user()
    r = await maybe_broadcast(uid, game="plinko", kind="plinko_drop",
                              payout_ton=10.0, multiplier=10.0)
    assert r is not None
    assert r["game"] == "plinko"
    assert r["payout_ton"] == 10.0


@pytest.mark.asyncio
async def test_recent_returns_persisted_rows():
    uid = await _user()
    await maybe_broadcast(uid, game="mines", kind="mines_cashout",
                          payout_ton=8.0, multiplier=8.0)
    rows = await recent(limit=10)
    assert len(rows) >= 1
    # The latest should be ours
    assert rows[0]["user_id"] == uid
