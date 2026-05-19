"""Phase 9 — Marketplace + VIP + Portals safety pytest."""
from __future__ import annotations

import os
import secrets

import pytest

from core.db import inventory_col, users_col
from core.time_utils import iso, now
from services.marketplace import (
    MarketError, browse, buy_listing, cancel_listing, list_item, my_listings,
)
from services.portals_modes import (
    PortalsConfigError, get_mode, is_within_daily_cap, is_within_per_tx_cap,
    safe_to_auto_fulfill, validate_startup_safety,
)
from services.vip import (
    TIERS, VipError, claim_rakeback, get_vip_state, increment_wagered,
    marketplace_fee_discount_bps, tier_for_wagered,
)


# ── Fixtures ────────────────────────────────────────────────────────────
async def _user(balance: float = 100.0, wagered: float = 0.0):
    uid = secrets.token_hex(12)
    tid = secrets.randbelow(10_000_000_000) + 90_000_000_000
    await users_col.insert_one({
        "id": uid, "telegram_id": tid, "username": f"p9_{tid}",
        "balance_ton": float(balance),
        "lifetime_wagered_ton": float(wagered),
        "free_spin_tokens": 0,
        "created_at": iso(now()), "updated_at": iso(now()),
    })
    return uid


async def _inventory_item(user_id: str, floor: float = 5.0,
                           slug: str = "gem_signet"):
    iid = secrets.token_hex(12)
    await inventory_col.insert_one({
        "id": iid, "user_id": user_id,
        "item_slug": slug, "item_name": "Gem Signet",
        "rarity": "rare", "image_path": f"items/{slug}.png",
        "payout_ton": float(floor),
        "status": "in_inventory", "marketplace_status": "off_sale",
        "case_id": "demo", "roll_id": f"r_{iid}",
        "created_at": iso(now()),
    })
    return iid


# ── VIP curve ───────────────────────────────────────────────────────────
def test_tier_curve_anchor_values():
    assert tier_for_wagered(0)["name"] == "Bronze"
    assert tier_for_wagered(100)["name"] == "Silver"
    assert tier_for_wagered(499)["name"] == "Silver"
    assert tier_for_wagered(500)["name"] == "Gold"
    assert tier_for_wagered(9_999)["name"] == "Platinum"
    assert tier_for_wagered(10_000)["name"] == "Diamond"
    assert tier_for_wagered(1_000_000)["name"] == "Diamond"


def test_tier_perks_strictly_grow():
    prev_rb = -1
    prev_xp = -1
    for t in TIERS:
        assert t["rakeback_bps"] > prev_rb
        assert t["xp_multiplier_bps"] >= prev_xp
        prev_rb = t["rakeback_bps"]
        prev_xp = t["xp_multiplier_bps"]


@pytest.mark.asyncio
async def test_increment_wagered_bumps_tier_snapshot():
    uid = await _user(wagered=0)
    await increment_wagered(uid, 600)  # crosses into Gold
    state = await get_vip_state(uid)
    assert state["tier"]["name"] == "Gold"
    u = await users_col.find_one({"id": uid}, {"_id": 0, "vip_tier": 1})
    assert int(u.get("vip_tier") or -1) == state["tier"]["tier_id"]


@pytest.mark.asyncio
async def test_marketplace_fee_discount_from_vip():
    uid = await _user(wagered=600)   # Gold → discount 100 bps
    bps = await marketplace_fee_discount_bps(uid)
    assert bps == 100


@pytest.mark.asyncio
async def test_claim_rakeback_idempotent_per_day():
    uid = await _user(wagered=600, balance=10)
    r = await claim_rakeback(uid)
    assert r["claimed_ton"] > 0
    with pytest.raises(VipError) as ei:
        await claim_rakeback(uid)
    assert "already_claimed" in str(ei.value)


@pytest.mark.asyncio
async def test_claim_rakeback_bronze_zero_payout_raises():
    uid = await _user(wagered=0)
    # Bronze has rakeback_bps > 0 but lifetime_wagered_ton = 0 → daily_payout = 0
    with pytest.raises(VipError):
        await claim_rakeback(uid)


# ── Marketplace happy path ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_and_browse():
    seller = await _user()
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 7.5)
    assert listing["price_ton"] == 7.5
    assert listing["status"] == "active"
    res = await browse(page_size=5)
    assert any(r["listing_id"] == listing["listing_id"] for r in res["rows"])


# Phase 11.1.1 Part B — guard against the bare-relative image_path
# regression. Every marketplace row's image_path MUST be the canonical
# absolute URL (matching /api/inventory + /api/cases). If this regresses
# back to "items/<slug>.png", consumers without fallback tolerance will
# fetch HTML and break.
@pytest.mark.asyncio
async def test_marketplace_image_path_is_canonical_absolute():
    seller = await _user()
    iid = await _inventory_item(seller)
    await list_item(seller, iid, 4.2)
    res = await browse(page_size=20)
    assert res["rows"], "browse should return at least one active listing"
    sample = next(r for r in res["rows"] if r.get("image_path"))
    assert sample["image_path"].startswith("/api/static/"), (
        f"image_path must be canonical absolute, got: {sample['image_path']!r}"
    )
    assert "items/" in sample["image_path"], (
        f"image_path must contain the items/ segment, got: {sample['image_path']!r}"
    )


@pytest.mark.asyncio
async def test_list_price_out_of_range():
    seller = await _user()
    iid = await _inventory_item(seller)
    with pytest.raises(MarketError):
        await list_item(seller, iid, 0.0001)


@pytest.mark.asyncio
async def test_list_not_owner():
    seller = await _user()
    other  = await _user()
    iid = await _inventory_item(seller)
    with pytest.raises(MarketError) as ei:
        await list_item(other, iid, 5)
    assert "not_owner" in str(ei.value)


@pytest.mark.asyncio
async def test_double_list_blocked():
    seller = await _user()
    iid = await _inventory_item(seller)
    await list_item(seller, iid, 5)
    with pytest.raises(MarketError):
        await list_item(seller, iid, 6)


@pytest.mark.asyncio
async def test_buy_atomic_transfer():
    seller = await _user(balance=0)
    buyer  = await _user(balance=100)
    iid = await _inventory_item(seller, floor=5)
    listing = await list_item(seller, iid, 10)

    r = await buy_listing(buyer, listing["listing_id"], vip_fee_discount_bps=0)
    assert r["price_ton"] == 10
    assert r["fee_ton"] == 0.5     # 5% of 10
    assert r["seller_credit_ton"] == 9.5
    # Buyer balance drained by 10
    bu = await users_col.find_one({"id": buyer}, {"_id": 0, "balance_ton": 1})
    assert bu["balance_ton"] == pytest.approx(90)
    # Seller credited with 9.5
    se = await users_col.find_one({"id": seller}, {"_id": 0, "balance_ton": 1})
    assert se["balance_ton"] == pytest.approx(9.5)
    # Inventory transferred
    inv = await inventory_col.find_one({"id": iid}, {"_id": 0, "user_id": 1, "marketplace_status": 1})
    assert inv["user_id"] == buyer
    assert inv["marketplace_status"] == "off_sale"


@pytest.mark.asyncio
async def test_buy_self_rejected():
    seller = await _user(balance=100)
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 5)
    with pytest.raises(MarketError) as ei:
        await buy_listing(seller, listing["listing_id"])
    assert "cannot_self_buy" in str(ei.value)


@pytest.mark.asyncio
async def test_buy_already_sold_rejected():
    seller = await _user()
    buyer1 = await _user(balance=100)
    buyer2 = await _user(balance=100)
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 5)
    await buy_listing(buyer1, listing["listing_id"])
    with pytest.raises(MarketError) as ei:
        await buy_listing(buyer2, listing["listing_id"])
    # Fix-G: distinct already_sold error (maps to HTTP 409 in router)
    assert "already_sold" in str(ei.value)


@pytest.mark.asyncio
async def test_buy_insufficient_balance_refunds_listing():
    seller = await _user()
    poor   = await _user(balance=0.5)
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 5)
    with pytest.raises(MarketError):
        await buy_listing(poor, listing["listing_id"])
    # Listing should be back to active so a real buyer can still purchase
    res = await browse(page_size=20)
    assert any(r["listing_id"] == listing["listing_id"] and r["status"] == "active"
               for r in res["rows"])


@pytest.mark.asyncio
async def test_cancel_unlocks_item():
    seller = await _user()
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 5)
    await cancel_listing(seller, listing["listing_id"])
    inv = await inventory_col.find_one({"id": iid}, {"_id": 0, "marketplace_status": 1})
    assert inv["marketplace_status"] == "off_sale"


@pytest.mark.asyncio
async def test_vip_discount_applied_at_buy():
    seller = await _user()
    buyer  = await _user(balance=100, wagered=600)   # Gold → 100 bps discount
    iid = await _inventory_item(seller)
    listing = await list_item(seller, iid, 10)

    bps = await marketplace_fee_discount_bps(buyer)
    r = await buy_listing(buyer, listing["listing_id"], vip_fee_discount_bps=bps)
    # Default fee 500 bps − VIP discount 100 bps = 400 bps = 4% on 10 = 0.4
    assert r["fee_ton"] == pytest.approx(0.4)
    assert r["seller_credit_ton"] == pytest.approx(9.6)


@pytest.mark.asyncio
async def test_my_listings_separates_active_and_history():
    seller = await _user()
    iid1 = await _inventory_item(seller)
    iid2 = await _inventory_item(seller)
    l1 = await list_item(seller, iid1, 5)
    l2 = await list_item(seller, iid2, 5)
    await cancel_listing(seller, l1["listing_id"])
    mine = await my_listings(seller)
    assert any(r["listing_id"] == l2["listing_id"] for r in mine["active"])
    assert any(r["listing_id"] == l1["listing_id"] for r in mine["history"])


# ── Portals modes ───────────────────────────────────────────────────────
def test_portals_default_mode_is_mock(monkeypatch):
    monkeypatch.delenv("PORTALS_MODE", raising=False)
    assert get_mode() == "mock"


def test_portals_validate_startup_safety_passes_in_mock(monkeypatch):
    monkeypatch.delenv("PORTALS_MODE", raising=False)
    monkeypatch.delenv("PORTALS_HOT_WALLET_MNEMONIC", raising=False)
    validate_startup_safety()  # should not raise


def test_portals_validate_startup_safety_rejects_live_without_mnemonic(monkeypatch):
    monkeypatch.setenv("PORTALS_MODE", "live")
    monkeypatch.delenv("PORTALS_HOT_WALLET_MNEMONIC", raising=False)
    with pytest.raises(PortalsConfigError):
        validate_startup_safety()


def test_portals_dry_run_does_not_require_mnemonic(monkeypatch):
    monkeypatch.setenv("PORTALS_MODE", "dry_run")
    monkeypatch.delenv("PORTALS_HOT_WALLET_MNEMONIC", raising=False)
    validate_startup_safety()


def test_portals_invalid_mode_rejected(monkeypatch):
    monkeypatch.setenv("PORTALS_MODE", "nonsense")
    with pytest.raises(PortalsConfigError):
        get_mode()


def test_portals_caps_default_to_5_and_10(monkeypatch):
    monkeypatch.delenv("PORTALS_DAILY_CAP_TON", raising=False)
    monkeypatch.delenv("PORTALS_PER_TX_CAP_TON", raising=False)
    assert is_within_per_tx_cap(4) is True
    assert is_within_per_tx_cap(5) is True
    assert is_within_per_tx_cap(5.01) is False
    assert is_within_daily_cap(9.99) is True
    assert is_within_daily_cap(10.01) is False


def test_safe_to_auto_fulfill_composite():
    assert safe_to_auto_fulfill(4.0, 5.0) is True
    assert safe_to_auto_fulfill(6.0, 0.0) is False   # per-tx cap
    assert safe_to_auto_fulfill(2.0, 9.0) is False   # would exceed daily


# ── Phase 11.1 — Jackpot-24h endpoint contract ──────────────────────────
@pytest.mark.asyncio
async def test_jackpot_24h_returns_sum_of_payouts():
    """`/api/activity/jackpot-24h` returns the sum of payout_ton across
    every live_activity event in the last 24h. Used by the home hero
    "TODAY'S JACKPOT" counter.

    Asserts: response shape + non-negative jackpot_ton + sample_size
    matches the row count returned by `top_24h(limit=10000)` for
    `filter='all'` (the same data source).
    """
    from services.activity import jackpot_24h, top_24h
    j = await jackpot_24h()
    assert isinstance(j, dict)
    assert {"jackpot_ton", "sample_size", "since"} <= set(j.keys())
    assert float(j["jackpot_ton"]) >= 0.0
    assert int(j["sample_size"]) >= 0
    # sample_size from jackpot should be ≥ the count of just the top-24h
    # rows (limit=10000 returns all rows in the window).
    all_rows = await top_24h(limit=10_000)
    assert j["sample_size"] == len(all_rows)
    # idempotent cached call within 5s — value should not change
    j2 = await jackpot_24h()
    assert j2["jackpot_ton"] == j["jackpot_ton"]


# ── Phase 10 / Fix-G — HTTP 409 contract on sold-listing buy ────────────
@pytest.mark.asyncio
async def test_buy_already_sold_returns_409_http():
    """End-to-end HTTP: re-buying a sold listing must return 409, not 400.

    Spins up the FastAPI app in-process via httpx.ASGITransport and uses
    dev-login to mint a real JWT (gated by ENABLE_DEV_LOGIN=true).
    """
    import secrets as _s

    import httpx
    from server import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test",
    ) as client:
        # 1. seller + buyer1 + buyer2 via dev-login
        async def _login(uname):
            tid = _s.randbelow(900_000_000) + 100_000_000
            r = await client.post(f"/api/auth/dev-login?telegram_id={tid}&username={uname}")
            assert r.status_code == 200, r.text
            return r.json()["token"], r.json()["user"]["id"]

        seller_tok, seller_uid = await _login("seller_409")
        buyer1_tok, buyer1_uid = await _login("buyer1_409")
        buyer2_tok, buyer2_uid = await _login("buyer2_409")

        # 2. seed an inventory item directly for the seller (skip case-open)
        iid = await _inventory_item(seller_uid, slug="gem_signet_409")
        # 3. fund buyer1 + buyer2 via dev-credit
        for tok in (buyer1_tok, buyer2_tok):
            r = await client.post(
                "/api/wallet/dev-credit?amount=100",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert r.status_code == 200, r.text

        # 4. seller lists
        r = await client.post(
            "/api/marketplace/list",
            json={"inventory_item_id": iid, "price_ton": 7.5},
            headers={"Authorization": f"Bearer {seller_tok}"},
        )
        assert r.status_code == 200, r.text
        listing_id = r.json()["listing_id"]

        # 5. buyer1 buys → 200
        r = await client.post(
            "/api/marketplace/buy", json={"listing_id": listing_id},
            headers={"Authorization": f"Bearer {buyer1_tok}"},
        )
        assert r.status_code == 200, r.text

        # 6. buyer2 tries to buy the now-sold listing → MUST return 409
        r = await client.post(
            "/api/marketplace/buy", json={"listing_id": listing_id},
            headers={"Authorization": f"Bearer {buyer2_tok}"},
        )
        assert r.status_code == 409, (
            f"Expected 409 Conflict on sold-listing rebuy, got "
            f"{r.status_code}: {r.text}"
        )
        body = r.json()
        assert body["detail"] in ("already_sold", "listing_already_sold")
