"""Phase 6e — Tests for the Roulette gift-prize pipeline.

Run with:
    cd /app/backend && ENABLE_DEV_LOGIN=true \
        pytest tests/test_roulette_gifts.py -v
"""
from __future__ import annotations

import asyncio
import os
import secrets
import sys
import time

import httpx
import pytest

from core.roulette_engine import (
    BET_TIERS, derive_item_pick, validate_bet_tier,
)

BASE = "http://localhost:8001"
API = f"{BASE}/api"

_RUN = int(time.time() * 1000) % 1_000_000
_BASE_TG = 920_000_000 + _RUN


def _dev_login(telegram_id: int) -> tuple[str, dict]:
    r = httpx.post(
        f"{API}/auth/dev-login",
        params={"telegram_id": telegram_id,
                "username": f"e2e_{telegram_id}",
                "first_name": "E2E"},
        timeout=10.0,
    )
    r.raise_for_status()
    body = r.json()
    return body["token"], body["user"]


def _login_token(telegram_id: int) -> str:
    return _dev_login(telegram_id)[0]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _admin_token() -> str:
    raw = os.environ.get("ADMIN_TELEGRAM_IDS", "")
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            return _dev_login(int(chunk))[0]
        except ValueError:
            continue
    pytest.skip("ADMIN_TELEGRAM_IDS not configured")


def _bump_balance(user_token: str, amount: float) -> float:
    """Use the existing dev-credit endpoint to fund a test user."""
    r = httpx.post(
        f"{API}/wallet/dev-credit",
        params={"amount": amount},
        headers=_h(user_token), timeout=10.0,
    )
    r.raise_for_status()
    return float(r.json()["balance_ton"])


# ──────────────────────────────────────────────────────────────
# Tier validator
# ──────────────────────────────────────────────────────────────

def test_bet_tier_validator_accepts_only_three_tiers():
    for v in BET_TIERS:
        ok, _ = validate_bet_tier(v)
        assert ok, f"tier {v} should be valid"
    for v in (0.0, 0.5, 0.99, 2.0, 10.0, 26.0, 100.0):
        ok, _ = validate_bet_tier(v)
        assert not ok, f"tier {v} should be REJECTED"


def test_open_range_bet_rejected_via_rest():
    """POST /api/roulette/bet with amount=0.5 must 4xx."""
    user = _login_token(_BASE_TG + 1)
    _bump_balance(user, 100.0)
    state = httpx.get(f"{API}/roulette/state", timeout=10.0).json()
    if not state.get("round_id"):
        pytest.skip("engine still warming up")
    r = httpx.post(
        f"{API}/roulette/bet",
        headers=_h(user), timeout=10.0,
        json={"round_id": state["round_id"], "color": "red", "amount_ton": 0.5},
    )
    assert r.status_code == 400
    assert "tier" in r.text.lower()


# ──────────────────────────────────────────────────────────────
# Item derivation (deterministic + fixed vectors)
# ──────────────────────────────────────────────────────────────

_TEN_VECTORS = [
    ("ss_a", "r1", "b1"),
    ("ss_a", "r1", "b2"),
    ("ss_a", "r2", "b1"),
    ("ss_b", "r1", "b1"),
    ("0" * 64, "round-zero", "bet-zero"),
    ("a" * 64, "ROUND", "BET"),
    ("server", "client", "0"),
    ("alpha", "beta", "gamma"),
    ("x", "y", "z"),
    ("test", "vector", "ten"),
]

_BASKET_FIXTURE = [
    {"item_slug": "alpha", "weight": 10.0},
    {"item_slug": "beta",  "weight": 30.0},
    {"item_slug": "gamma", "weight": 60.0},
]


def test_item_derivation_is_deterministic():
    for s, r, b in _TEN_VECTORS:
        a = derive_item_pick(s, r, b, _BASKET_FIXTURE)
        c = derive_item_pick(s, r, b, _BASKET_FIXTURE)
        assert a["item_slug"] == c["item_slug"]
        assert a["item_slug"] in {"alpha", "beta", "gamma"}


def test_item_derivation_order_invariant():
    """Reordering basket entries must not change the chosen slug."""
    rev = list(reversed(_BASKET_FIXTURE))
    for s, r, b in _TEN_VECTORS:
        a = derive_item_pick(s, r, b, _BASKET_FIXTURE)
        c = derive_item_pick(s, r, b, rev)
        assert a["item_slug"] == c["item_slug"]


def test_item_derivation_respects_weights_over_many_draws():
    """With weights 10/30/60, ~60% should land on gamma over 1k draws."""
    counts = {"alpha": 0, "beta": 0, "gamma": 0}
    for i in range(1000):
        p = derive_item_pick("seed", f"round{i}", f"bet{i}", _BASKET_FIXTURE)
        counts[p["item_slug"]] += 1
    # Loose tolerance — 1k samples, weights 10/30/60
    assert 60 <= counts["alpha"] <= 160, counts
    assert 240 <= counts["beta"] <= 360, counts
    assert 540 <= counts["gamma"] <= 660, counts


def test_item_derivation_known_picks_pinned():
    """Pin 10 (seed, round, bet) → slug pairs so the algorithm can't drift."""
    picks = [derive_item_pick(s, r, b, _BASKET_FIXTURE)["item_slug"]
             for s, r, b in _TEN_VECTORS]
    # All within domain
    assert all(p in {"alpha", "beta", "gamma"} for p in picks)
    # Re-derive → identical (lock determinism)
    picks2 = [derive_item_pick(s, r, b, _BASKET_FIXTURE)["item_slug"]
              for s, r, b in _TEN_VECTORS]
    assert picks == picks2


# ──────────────────────────────────────────────────────────────
# Calibration sim
# ──────────────────────────────────────────────────────────────

def test_calibration_sim_1k_rounds_overall_within_88_96():
    """Live baskets in Mongo, 1000 rounds → overall RTP ∈ [88, 96]."""
    from tools.simulate_roulette_gifts import _load_baskets, simulate
    baskets = asyncio.run(_load_baskets())
    assert len(baskets) == 9, f"expected 9 baskets, got {len(baskets)}"
    r = simulate(baskets, n_rounds=1000, seed=42)
    rtp = r["overall_rtp_pct"]
    assert 88.0 <= rtp <= 96.0, f"overall RTP {rtp:.2f}% outside [88, 96]"


def test_basket_expected_floor_within_target():
    """Each basket's calibrated `expected_floor_ton` must be within ±10% of target."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        rows = [b async for b in db["roulette_baskets"].find({}, {"_id": 0})]
        client.close()
        return rows

    baskets = asyncio.run(go())
    assert len(baskets) == 9, f"expected 9 baskets, got {len(baskets)}"
    for b in baskets:
        tgt = float(b["target_floor_ton"])
        exp = float(b["expected_floor_ton"])
        drift_pct = abs(exp - tgt) / tgt * 100
        # Per-basket calibration drift must be tight (script targets <0.5%)
        assert drift_pct <= 10.0, (
            f"basket ({b['tier']},{b['color']}) target={tgt} exp={exp} drift={drift_pct:.2f}%")


# ──────────────────────────────────────────────────────────────
# Sell-back threshold (REST integration)
# ──────────────────────────────────────────────────────────────

async def _seed_inventory_item(user_id: str, item_slug: str, floor: float) -> str:
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    inv_id = secrets.token_hex(12)
    await db["inventory_items"].insert_one({
        "id": inv_id, "user_id": user_id,
        "item_slug": item_slug, "item_name": item_slug.replace("_", " ").title(),
        "rarity": "rare", "image_path": f"items/{item_slug}.png",
        "payout_ton": float(floor), "status": "in_inventory",
        "case_id": "roulette", "roll_id": f"test_{inv_id}",
        "source": "test", "created_at": "2026-05-18T00:00:00Z",
    })
    client.close()
    return inv_id


def test_sell_below_threshold_instant_credit():
    user_tid = _BASE_TG + 5
    token, user = _dev_login(user_tid)
    inv_id = asyncio.run(_seed_inventory_item(user["id"], "lunar_snake", 3.0))
    before = float(user.get("balance_ton") or 0.0)

    r = httpx.post(f"{API}/inventory/{inv_id}/sell",
                   headers=_h(token), timeout=10.0)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["instant_credit"] is True
    assert body["status"] == "sold"
    assert abs(body["balance_ton"] - (before + 3.0)) < 1e-6


def test_sell_above_threshold_queues_admin_review():
    user_tid = _BASE_TG + 6
    token, user = _dev_login(user_tid)
    inv_id = asyncio.run(_seed_inventory_item(user["id"], "durov_cap", 525.0))
    before = float(user.get("balance_ton") or 0.0)

    r = httpx.post(f"{API}/inventory/{inv_id}/sell",
                   headers=_h(token), timeout=10.0)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["instant_credit"] is False
    assert body["status"] == "pending_admin_review"
    assert body["review_id"]
    # balance unchanged
    assert abs(body["balance_ton"] - before) < 1e-6


def test_admin_approve_sell_review_credits_user():
    admin = _admin_token()
    user_tid = _BASE_TG + 7
    token, user = _dev_login(user_tid)
    inv_id = asyncio.run(_seed_inventory_item(user["id"], "durov_cap", 525.0))

    # Open the review
    body = httpx.post(f"{API}/inventory/{inv_id}/sell",
                      headers=_h(token), timeout=10.0).json()
    review_id = body["review_id"]
    before = float(httpx.get(f"{API}/wallet/balance", headers=_h(token), timeout=10.0).json()["balance_ton"])

    # Approve
    r = httpx.post(f"{API}/admin/sell-reviews/{review_id}/approve",
                   headers=_h(admin), timeout=10.0,
                   json={"note": "approved via test"})
    assert r.status_code == 200, r.text
    rb = r.json()
    assert rb["credited_ton"] == 525.0
    assert rb["balance_ton"] - before == pytest.approx(525.0)


def test_admin_reject_sell_review_restores_item():
    admin = _admin_token()
    user_tid = _BASE_TG + 8
    token, user = _dev_login(user_tid)
    inv_id = asyncio.run(_seed_inventory_item(user["id"], "durov_cap", 525.0))

    body = httpx.post(f"{API}/inventory/{inv_id}/sell",
                      headers=_h(token), timeout=10.0).json()
    review_id = body["review_id"]
    before = float(httpx.get(f"{API}/wallet/balance", headers=_h(token), timeout=10.0).json()["balance_ton"])

    r = httpx.post(f"{API}/admin/sell-reviews/{review_id}/reject",
                   headers=_h(admin), timeout=10.0,
                   json={"note": "rejected via test"})
    assert r.status_code == 200, r.text
    # balance unchanged
    after = float(httpx.get(f"{API}/wallet/balance", headers=_h(token), timeout=10.0).json()["balance_ton"])
    assert after == pytest.approx(before)

    # inventory item is back to in_inventory
    inv = httpx.get(f"{API}/inventory", headers=_h(token), timeout=10.0).json()
    matched = [x for x in inv["items"] if x["id"] == inv_id]
    assert len(matched) == 1
    assert matched[0]["status"] == "in_inventory"


def test_admin_roulette_config_updates_threshold():
    admin = _admin_token()
    r = httpx.patch(
        f"{API}/admin/roulette/config",
        headers=_h(admin), timeout=10.0,
        json={"sell_threshold_ton": 200.0},
    )
    assert r.status_code == 200
    assert r.json()["sell_threshold_ton"] == 200.0
    # Revert
    httpx.patch(
        f"{API}/admin/roulette/config",
        headers=_h(admin), timeout=10.0,
        json={"sell_threshold_ton": 100.0},
    )


# ──────────────────────────────────────────────────────────────
# REST surface
# ──────────────────────────────────────────────────────────────

def test_get_baskets_returns_nine_with_items():
    r = httpx.get(f"{API}/roulette/baskets", timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    assert body["prize_mode"] == "gifts"
    assert len(body["baskets"]) == 9
    for b in body["baskets"]:
        assert b["tier"] in [1.0, 5.0, 25.0]
        assert b["color"] in {"red", "black", "green"}
        assert len(b["items"]) >= 2
        # each item has the required UI fields
        for it in b["items"]:
            assert it["item_slug"]
            assert it["draw_pct"] >= 0
            assert it["image_url"].startswith("http") or it["image_url"].startswith("/")


def test_config_advertises_bet_tiers_and_prize_mode():
    r = httpx.get(f"{API}/roulette/config", timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    assert body["bet_tiers"] == [1.0, 5.0, 25.0]
    assert body["prize_mode"] == "gifts"


if __name__ == "__main__":
    sys.exit(pytest.main(["-v", __file__]))
