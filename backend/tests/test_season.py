"""Phase 7c — Battle Pass / Seasons tests.

Covers:
  • XP curve sanity (xp_for_tier(1)=105, xp_for_tier(30)=7500)
  • cumulative_xp_for_tier monotonic
  • tier_from_xp reverse lookup
  • Idempotent award_xp (same event_id → no double-credit)
  • claim_tier: free track grants reward + marks claimed
  • claim_tier: second call → already_claimed
  • claim_tier: tier_not_yet_unlocked
  • claim_tier: premium without unlock → 400
  • unlock_premium: 50 TON debited + flag flips + retroactive claim works
  • unlock_premium: already unlocked → 400
  • Concurrent claim race → exactly one success
  • Leaderboard ordering
  • Season rollover: ends_at < now → frozen + new active
"""
from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import pytest

from core.db import db, users_col
from core.season_engine import (
    PREMIUM_UNLOCK_TON, TOTAL_TIERS, cumulative_xp_for_tier, default_tier_rewards,
    tier_from_xp, xp_for_tier, xp_progress_into_current_tier,
)
from core.time_utils import iso, now
from services.season import (
    SeasonError, award_xp, claim_tier, ensure_indexes, force_end_season,
    get_or_create_active_season, get_user_progress, hydrate_progress,
    maybe_award_daily_login, rollover_if_needed, unlock_premium,
)


seasons_col   = db["seasons"]
progress_col  = db["user_season_progress"]
xp_events_col = db["season_xp_events"]
inventory_col = db["inventory_items"]


# ─── Pure XP curve ─────────────────────────────────────────────────────────
def test_xp_for_tier_anchor_values():
    assert xp_for_tier(1) == 105      # 100*1 + 5*1*1
    assert xp_for_tier(30) == 7500    # 100*30 + 5*30*30
    assert xp_for_tier(0) == 0


def test_xp_for_tier_monotonic_strictly_increasing():
    prev = -1
    for n in range(1, 31):
        v = xp_for_tier(n)
        assert v > prev, (n, v, prev)
        prev = v


def test_cumulative_xp_matches_sum():
    assert cumulative_xp_for_tier(1) == 105
    assert cumulative_xp_for_tier(2) == 105 + xp_for_tier(2)
    assert cumulative_xp_for_tier(30) == sum(xp_for_tier(i) for i in range(1, 31))


def test_tier_from_xp_boundary_cases():
    # 0 XP → tier 0
    assert tier_from_xp(0) == 0
    # one shy of tier 1
    assert tier_from_xp(xp_for_tier(1) - 1) == 0
    # exactly enough for tier 1
    assert tier_from_xp(cumulative_xp_for_tier(1)) == 1
    # exactly enough for tier 5
    assert tier_from_xp(cumulative_xp_for_tier(5)) == 5
    # one shy of tier 30
    cap = cumulative_xp_for_tier(30)
    assert tier_from_xp(cap - 1) == 29
    # at/above cap → caps at 30
    assert tier_from_xp(cap) == 30
    assert tier_from_xp(cap * 2) == 30


def test_xp_progress_into_current_tier():
    # At exactly cum(5) → 0 into tier 6, need tier-6 XP
    into, need, nxt = xp_progress_into_current_tier(cumulative_xp_for_tier(5))
    assert into == 0
    assert need == xp_for_tier(6)
    assert nxt == 6
    # 50 XP past cum(5)
    into, need, nxt = xp_progress_into_current_tier(cumulative_xp_for_tier(5) + 50)
    assert into == 50
    # At cap → 0/0 for "no next"
    into, need, nxt = xp_progress_into_current_tier(cumulative_xp_for_tier(30))
    assert (into, need, nxt) == (0, 0, TOTAL_TIERS)


def test_default_tier_rewards_shape():
    rows = default_tier_rewards()
    assert len(rows) == TOTAL_TIERS
    for i, row in enumerate(rows, start=1):
        assert row["tier"] == i
        assert row["xp_required"] == cumulative_xp_for_tier(i)
        # Every tier must have at least one reward on both tracks (per brief)
        assert len(row["free_rewards"]) >= 1
        assert len(row["premium_rewards"]) >= 1
    # Tier 30 free reward must be a legendary item per brief
    assert rows[29]["free_rewards"][0]["type"] == "item"
    # Tier 30 premium reward = TON 100 (matches brief: "+100 TON")
    prem30 = rows[29]["premium_rewards"][0]
    assert prem30["type"] == "ton"
    assert float(prem30["amount_ton"]) == 100.0


# ─── DB fixtures ────────────────────────────────────────────────────────────
async def _fresh_user(balance_ton: float = 1000.0) -> dict:
    tid = secrets.randbelow(10_000_000_000) + 90_000_000_000
    uid = secrets.token_hex(12)
    doc = {
        "id": uid,
        "telegram_id": tid,
        "username": f"t_{tid}",
        "balance_ton": float(balance_ton),
        "free_spin_tokens": 0,
        "created_at": iso(now()),
        "updated_at": iso(now()),
    }
    await users_col.insert_one(doc)
    return doc


async def _fresh_season() -> dict:
    """Wipe & re-create the season so each test runs on a clean slate."""
    await seasons_col.delete_many({})
    await progress_col.delete_many({})
    await xp_events_col.delete_many({})
    await ensure_indexes()
    return await get_or_create_active_season()


# ─── award_xp idempotency ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_award_xp_credits_once_per_event_id():
    season = await _fresh_season()
    user = await _fresh_user()
    eid = secrets.token_hex(8)
    r1 = await award_xp(user["id"], 100, "case_open", eid)
    assert r1["awarded"] == 100
    assert r1["already_awarded"] is False
    assert r1["new_xp"] == 100
    # Replay
    r2 = await award_xp(user["id"], 100, "case_open", eid)
    assert r2["awarded"] == 0
    assert r2["already_awarded"] is True
    assert r2["new_xp"] == 100      # NOT 200


@pytest.mark.asyncio
async def test_award_xp_different_event_ids_stack():
    await _fresh_season()
    user = await _fresh_user()
    await award_xp(user["id"], 50, "case_open", "e1")
    await award_xp(user["id"], 50, "case_open", "e2")
    await award_xp(user["id"], 50, "case_open", "e3")
    prog = await get_user_progress(user["id"], (await get_or_create_active_season())["season_id"])
    assert prog["xp"] == 150


@pytest.mark.asyncio
async def test_award_xp_zero_or_negative_is_noop():
    await _fresh_season()
    user = await _fresh_user()
    r = await award_xp(user["id"], 0, "case_open", "ez")
    assert r.get("skipped") is True
    # Audit row must NOT have been created
    audit = await xp_events_col.find_one({"event_id": "ez"})
    assert audit is None


@pytest.mark.asyncio
async def test_award_xp_invalid_source_raises():
    await _fresh_season()
    user = await _fresh_user()
    with pytest.raises(SeasonError):
        await award_xp(user["id"], 10, "not_a_real_source", "e1")


# ─── Daily login XP ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_daily_login_only_once_per_day():
    await _fresh_season()
    user = await _fresh_user()
    r1 = await maybe_award_daily_login(user["id"])
    r2 = await maybe_award_daily_login(user["id"])
    assert r1["awarded"] == 25
    assert r1["already_awarded"] is False
    assert r2["awarded"] == 0
    assert r2["already_awarded"] is True


# ─── Tier claim ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_claim_tier_free_track_grants_reward():
    season = await _fresh_season()
    user = await _fresh_user(balance_ton=0.0)
    # Tier 1 free is "ton 0.5" per the default ladder
    await award_xp(user["id"], xp_for_tier(1) + 5, "case_open", "e1")
    res = await claim_tier(user["id"], season["season_id"], tier=1, track="free")
    assert res["tier"] == 1
    assert res["track"] == "free"
    assert any(r["type"] == "ton" for r in res["rewards_granted"])
    # Balance should be +0.5 TON
    u = await users_col.find_one({"id": user["id"]}, {"_id": 0, "balance_ton": 1})
    assert u["balance_ton"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_claim_tier_double_claim_raises():
    season = await _fresh_season()
    user = await _fresh_user()
    await award_xp(user["id"], cumulative_xp_for_tier(3), "case_open", "e1")
    await claim_tier(user["id"], season["season_id"], tier=2, track="free")
    with pytest.raises(SeasonError) as exc:
        await claim_tier(user["id"], season["season_id"], tier=2, track="free")
    assert "already_claimed" in str(exc.value)


@pytest.mark.asyncio
async def test_claim_tier_not_yet_unlocked_raises():
    season = await _fresh_season()
    user = await _fresh_user()
    # User has 0 XP — can't claim tier 5
    with pytest.raises(SeasonError) as exc:
        await claim_tier(user["id"], season["season_id"], tier=5, track="free")
    assert "tier_not_yet_unlocked" in str(exc.value)


@pytest.mark.asyncio
async def test_claim_premium_without_unlock_raises():
    season = await _fresh_season()
    user = await _fresh_user()
    await award_xp(user["id"], cumulative_xp_for_tier(2), "case_open", "e1")
    with pytest.raises(SeasonError) as exc:
        await claim_tier(user["id"], season["season_id"], tier=1, track="premium")
    assert "premium_not_unlocked" in str(exc.value)


@pytest.mark.asyncio
async def test_concurrent_claim_race_exactly_one_succeeds():
    """Two parallel claims for the same tier+track → exactly one 200, one 400."""
    season = await _fresh_season()
    user = await _fresh_user()
    await award_xp(user["id"], cumulative_xp_for_tier(3), "case_open", "e1")

    async def claim():
        try:
            return await claim_tier(user["id"], season["season_id"], tier=2, track="free")
        except SeasonError as e:
            return ("error", str(e))

    res = await asyncio.gather(claim(), claim())
    successes = [r for r in res if not (isinstance(r, tuple) and r[0] == "error")]
    failures  = [r for r in res if (isinstance(r, tuple) and r[0] == "error")]
    assert len(successes) == 1, res
    assert len(failures)  == 1, res
    assert "already_claimed" in failures[0][1]


# ─── Premium unlock ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_unlock_premium_debits_50_ton_and_flips_flag():
    season = await _fresh_season()
    user = await _fresh_user(balance_ton=200.0)
    res = await unlock_premium(user["id"], season["season_id"])
    assert res["premium_unlocked"] is True
    assert res["debited_ton"] == PREMIUM_UNLOCK_TON == 50.0
    assert res["balance_ton"] == pytest.approx(150.0)
    prog = await get_user_progress(user["id"], season["season_id"])
    assert prog["premium_unlocked"] is True


@pytest.mark.asyncio
async def test_unlock_premium_already_unlocked_raises():
    season = await _fresh_season()
    user = await _fresh_user(balance_ton=200.0)
    await unlock_premium(user["id"], season["season_id"])
    with pytest.raises(SeasonError) as exc:
        await unlock_premium(user["id"], season["season_id"])
    assert "already_unlocked" in str(exc.value)


@pytest.mark.asyncio
async def test_unlock_premium_insufficient_balance_raises():
    season = await _fresh_season()
    user = await _fresh_user(balance_ton=49.0)
    with pytest.raises(SeasonError) as exc:
        await unlock_premium(user["id"], season["season_id"])
    assert "insufficient_balance" in str(exc.value)


@pytest.mark.asyncio
async def test_unlock_premium_allows_retroactive_premium_claims():
    season = await _fresh_season()
    user = await _fresh_user(balance_ton=200.0)
    # Earn enough XP for tier 3
    await award_xp(user["id"], cumulative_xp_for_tier(3), "case_open", "e1")
    # First try premium tier 2 → must fail (not unlocked)
    with pytest.raises(SeasonError):
        await claim_tier(user["id"], season["season_id"], tier=2, track="premium")
    # Unlock premium
    await unlock_premium(user["id"], season["season_id"])
    # Now retroactive claim works
    res = await claim_tier(user["id"], season["season_id"], tier=2, track="premium")
    assert res["track"] == "premium"


# ─── Leaderboard ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_leaderboard_orders_by_xp_desc():
    from services.season import get_leaderboard
    season = await _fresh_season()
    a = await _fresh_user(); b = await _fresh_user(); c = await _fresh_user()
    await award_xp(a["id"],  50, "case_open", "ea")
    await award_xp(b["id"], 500, "case_open", "eb")
    await award_xp(c["id"], 200, "case_open", "ec")
    rows = await get_leaderboard(season["season_id"], limit=10)
    xps = [r["xp"] for r in rows]
    assert xps == sorted(xps, reverse=True)
    assert xps[:3] == [500, 200, 50]
    # Top entry has the right user_id
    assert rows[0]["user_id"] == b["id"]


# ─── Rollover ───────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_rollover_creates_next_season_when_past_ends_at():
    """When the active season's ends_at < now, rollover_if_needed should:
       1. flip status to frozen
       2. create the next active season
    """
    await _fresh_season()
    # Manually backdate the active season
    past = iso(now() - timedelta(seconds=1))
    await seasons_col.update_one(
        {"status": "active"}, {"$set": {"ends_at": past}},
    )
    new = await rollover_if_needed()
    assert new is not None
    assert new["status"] == "active"
    # Old one is now frozen
    frozen = await seasons_col.find_one({"status": "frozen"})
    assert frozen is not None


@pytest.mark.asyncio
async def test_rollover_noop_when_not_expired():
    await _fresh_season()
    rolled = await rollover_if_needed()
    assert rolled is None


@pytest.mark.asyncio
async def test_force_end_season_flips_and_creates_next():
    season = await _fresh_season()
    res = await force_end_season(season["season_id"])
    assert res["frozen"]["season_id"] == season["season_id"]
    assert res["frozen"]["status"] == "frozen"
    assert res["next"]["status"] == "active"
    assert res["next"]["season_id"] != season["season_id"]


# ─── Hydration ──────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_hydrate_progress_computes_derived_fields():
    await _fresh_season()
    user = await _fresh_user()
    await award_xp(user["id"], cumulative_xp_for_tier(4) + 30, "case_open", "ek")
    prog = await get_user_progress(user["id"], (await get_or_create_active_season())["season_id"])
    hydrated = hydrate_progress(prog)
    assert hydrated["current_tier"] == 4
    assert hydrated["xp_into_current_tier"] == 30
    assert hydrated["xp_for_next_tier"] == xp_for_tier(5)
    assert hydrated["next_tier"] == 5
    assert hydrated["total_tiers"] == TOTAL_TIERS
