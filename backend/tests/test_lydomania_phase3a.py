"""Phase 3a — Admin foundations & CRUD regression + new feature tests.

Covers:
- Regression: Phase 0/1/1b/2 endpoint smoke (health, openapi, dev-login, cases,
  fair, inventory, withdrawals, referrals, share-card, internal, admin queue).
- Admin auth: both admin TG ids (sentinel 100000001, real 1862754938) and
  non-admin gating (403 on /api/admin/*).
- Admin Cases CRUD: list, create (incl. duplicate 409), patch, calibrate,
  stats, soft-delete + public hides disabled while include_disabled exposes.
- Admin Items CRUD: list w/ search + cases_using, create (incl. 409), patch,
  delete (incl. 409 on in-use), refetch-from-fragment.
- Admin Settings: GET singleton 14 fields, PATCH persists, validation 422.
- Admin Portals: auth paste-in fingerprint, test returns structured error.
- Referral ladder + anti-abuse (self-referral block) and tier-based math.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
INTERNAL_SECRET = "lydo_internal_dev_secret_71fc28a04bdf1c9e5a3b2e6d8f0c1a4b"

ADMIN_TG_SENTINEL = 100000001
ADMIN_TG_REAL = 1862754938
NON_ADMIN_TG_BASE = 400000 + (int(time.time()) % 90000)  # unique per run


def _login(tg_id: int, username: str = "tester", first_name: str = "Tester") -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/dev-login",
        params={"telegram_id": tg_id, "username": username, "first_name": first_name},
        timeout=15,
    )
    assert r.status_code == 200, f"dev-login failed for {tg_id}: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_TG_SENTINEL, username="admin_sentinel", first_name="Admin")


@pytest.fixture(scope="module")
def admin_token_real() -> str:
    return _login(ADMIN_TG_REAL, username="admin_real", first_name="Owner")


@pytest.fixture(scope="module")
def user_token() -> str:
    return _login(NON_ADMIN_TG_BASE + 1, username=f"user_{NON_ADMIN_TG_BASE + 1}")


# ---------------------------------------------------------------------------
# Regression: Phase 0/1/1b/2 surface — confirm 200 + shape only.
# ---------------------------------------------------------------------------
class TestRegressionRefactor:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_openapi(self):
        # openapi spec is served at root /openapi.json (ingress routes /api/* to backend
        # but FastAPI exposes its schema at /openapi.json). Verify via /docs which IS at /api ingress.
        r = requests.get(f"{BASE_URL}/openapi.json", timeout=10)
        assert r.status_code == 200
        paths = r.json().get("paths", {})
        # All Phase 3a admin endpoints registered
        for p in [
            "/api/admin/cases", "/api/admin/items", "/api/admin/settings",
            "/api/admin/portals/auth", "/api/admin/portals/test",
        ]:
            assert p in paths, f"missing route {p}"

    def test_dev_login_and_me(self, user_token):
        r = requests.get(f"{BASE_URL}/api/me", headers=_auth(user_token), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["is_admin"] is False
        assert "balance_ton" in body

    def test_dev_credit(self, user_token):
        r = requests.post(f"{BASE_URL}/api/wallet/dev-credit?amount=50", headers=_auth(user_token), timeout=10)
        assert r.status_code == 200
        assert r.json().get("balance_ton", 0) >= 50

    def test_cases_list_and_detail(self):
        r = requests.get(f"{BASE_URL}/api/cases", timeout=10)
        assert r.status_code == 200
        cases = r.json()
        assert isinstance(cases, list) and len(cases) >= 1
        # detail
        slug = "stickers_box"
        r2 = requests.get(f"{BASE_URL}/api/cases/{slug}", timeout=10)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["id"] == slug
        assert isinstance(body.get("items") or body.get("basket"), list)

    def test_case_open_and_fair(self, user_token):
        # Ensure balance
        requests.post(f"{BASE_URL}/api/wallet/dev-credit?amount=200", headers=_auth(user_token), timeout=10)
        f = requests.get(f"{BASE_URL}/api/fair/current", headers=_auth(user_token), timeout=10)
        assert f.status_code == 200
        assert "server_seed_hash" in f.json()
        r = requests.post(
            f"{BASE_URL}/api/cases/stickers_box/open",
            headers={**_auth(user_token), "Content-Type": "application/json"},
            json={"client_seed": "regression-seed"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "roll_id" in body and "inventory_id" in body
        # fair verify
        v = requests.get(f"{BASE_URL}/api/fair/verify", params={"round_id": body["roll_id"]}, timeout=10)
        assert v.status_code == 200
        assert v.json().get("verified") is True

    def test_inventory_and_sell(self, user_token):
        requests.post(f"{BASE_URL}/api/wallet/dev-credit?amount=200", headers=_auth(user_token), timeout=10)
        op = requests.post(
            f"{BASE_URL}/api/cases/stickers_box/open",
            headers={**_auth(user_token), "Content-Type": "application/json"},
            json={"client_seed": "regression-sell"}, timeout=15,
        ).json()
        inv_id = op["inventory_id"]
        inv = requests.get(f"{BASE_URL}/api/inventory", headers=_auth(user_token), timeout=10)
        assert inv.status_code == 200
        sell = requests.post(f"{BASE_URL}/api/inventory/{inv_id}/sell", headers=_auth(user_token), timeout=10)
        assert sell.status_code == 200, sell.text
        assert "new_balance" in sell.json()

    def test_withdraw_request_and_cancel(self, user_token):
        requests.post(f"{BASE_URL}/api/wallet/dev-credit?amount=200", headers=_auth(user_token), timeout=10)
        op = requests.post(
            f"{BASE_URL}/api/cases/stickers_box/open",
            headers={**_auth(user_token), "Content-Type": "application/json"},
            json={"client_seed": "regression-withdraw"}, timeout=15,
        ).json()
        inv_id = op["inventory_id"]
        w = requests.post(
            f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
            headers={**_auth(user_token), "Content-Type": "application/json"},
            json={"destination_address": "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"},
            timeout=10,
        )
        assert w.status_code == 200, w.text
        wid = w.json()["id"]
        me_wd = requests.get(f"{BASE_URL}/api/withdrawals/me", headers=_auth(user_token), timeout=10)
        assert me_wd.status_code == 200
        cancel = requests.post(f"{BASE_URL}/api/withdrawals/{wid}/cancel", headers=_auth(user_token), timeout=10)
        assert cancel.status_code == 200

    def test_referrals_me(self, user_token):
        r = requests.get(f"{BASE_URL}/api/referrals/me", headers=_auth(user_token), timeout=10)
        assert r.status_code == 200
        b = r.json()
        assert "ref_code" in b and "current_tier" in b

    def test_share_card_generate(self, user_token):
        # share-card requires roll_id query — open a case to get one
        requests.post(f"{BASE_URL}/api/wallet/dev-credit?amount=200", headers=_auth(user_token), timeout=10)
        op = requests.post(
            f"{BASE_URL}/api/cases/stickers_box/open",
            headers={**_auth(user_token), "Content-Type": "application/json"},
            json={"client_seed": "share-seed"}, timeout=15,
        ).json()
        roll_id = op["roll_id"]
        r = requests.post(
            f"{BASE_URL}/api/share-card/generate",
            params={"roll_id": roll_id},
            headers=_auth(user_token), timeout=20,
        )
        assert r.status_code in (200, 201), r.text

    def test_internal_balance(self, user_token):
        # Get tg id from /api/me
        me = requests.get(f"{BASE_URL}/api/me", headers=_auth(user_token), timeout=10).json()
        tg = me["telegram_id"]
        r = requests.get(
            f"{BASE_URL}/api/internal/user/{tg}/balance",
            headers={"X-Internal-Secret": INTERNAL_SECRET}, timeout=10,
        )
        assert r.status_code == 200
        assert "balance_ton" in r.json()

    def test_admin_withdrawals_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/withdrawals?status=pending", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# Phase 3a: Admin auth - both admin ids + non-admin gating
# ---------------------------------------------------------------------------
class TestAdminAuth:
    def test_admin_sentinel_is_admin(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/me", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_admin_real_is_admin(self, admin_token_real):
        r = requests.get(f"{BASE_URL}/api/me", headers=_auth(admin_token_real), timeout=10)
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_non_admin_user(self, user_token):
        r = requests.get(f"{BASE_URL}/api/me", headers=_auth(user_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["is_admin"] is False

    def test_non_admin_blocked_from_admin_routes(self, user_token):
        for path in ["/api/admin/cases", "/api/admin/items", "/api/admin/settings", "/api/admin/withdrawals"]:
            r = requests.get(f"{BASE_URL}{path}", headers=_auth(user_token), timeout=10)
            assert r.status_code == 403, f"{path} expected 403, got {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# Phase 3a: Admin Cases CRUD
# ---------------------------------------------------------------------------
class TestAdminCases:
    CASE_ID = "test_3a_case"

    def test_list_includes_seeded(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/cases", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        cases = r.json()
        assert isinstance(cases, list)
        # At least 5 seeded cases should exist
        assert len(cases) >= 5

    def test_create_case(self, admin_token):
        # Cleanup leftover from prior runs (soft-delete is idempotent — just patch enabled)
        requests.delete(f"{BASE_URL}/api/admin/cases/{self.CASE_ID}", headers=_auth(admin_token), timeout=10)
        # Try fresh create, but if it already exists from prior run -> patch instead
        payload = {
            "id": self.CASE_ID, "name": "Test 3a Case", "price_ton": 2.0,
            "target_ev_pct": 90.0, "enabled": True,
            "basket": [
                {"slug": "lol_pop", "weight": 70, "payout_ton": 1.0},
                {"slug": "snake_box", "weight": 28, "payout_ton": 3.0},
                {"slug": "plush_pepe", "weight": 2, "payout_ton": 30.0},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/admin/cases", headers=_auth(admin_token), json=payload, timeout=10)
        if r.status_code == 409:
            # Already exists from previous run — re-enable & patch
            requests.patch(
                f"{BASE_URL}/api/admin/cases/{self.CASE_ID}",
                headers=_auth(admin_token),
                json={"enabled": True, "basket": payload["basket"]}, timeout=10,
            )
        else:
            assert r.status_code in (200, 201), r.text
            body = r.json()
            assert body["id"] == self.CASE_ID
            assert "actual_ev_pct" in body or "ev_pct" in body or "items" in body

    def test_create_duplicate_409(self, admin_token):
        payload = {
            "id": self.CASE_ID, "name": "Dup", "price_ton": 1.0, "target_ev_pct": 90,
            "basket": [{"slug": "lol_pop", "weight": 1, "payout_ton": 1.0}],
        }
        r = requests.post(f"{BASE_URL}/api/admin/cases", headers=_auth(admin_token), json=payload, timeout=10)
        assert r.status_code == 409, f"expected 409 got {r.status_code} {r.text[:200]}"

    def test_patch_case(self, admin_token):
        r = requests.patch(
            f"{BASE_URL}/api/admin/cases/{self.CASE_ID}",
            headers=_auth(admin_token),
            json={"name": "Renamed 3a", "target_ev_pct": 88.0}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "Renamed 3a"

    def test_calibrate(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/cases/{self.CASE_ID}/calibrate",
            headers=_auth(admin_token),
            json={"target_ev_pct": 88.0}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "feasible" in body
        assert "jackpot_slug" in body
        # If feasible, must include recommended weight
        if body.get("feasible"):
            assert body.get("recommended_jackpot_weight") is not None

    def test_stats(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/cases/{self.CASE_ID}/stats", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["case_id"] == self.CASE_ID
        assert body["total_opens"] == 0
        assert body["realized_rtp_pct"] == 0
        assert "drift_pct" in body

    def test_soft_delete_and_public_hides(self, admin_token):
        r = requests.delete(f"{BASE_URL}/api/admin/cases/{self.CASE_ID}", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        # public list (no auth) should NOT include disabled
        pub = requests.get(f"{BASE_URL}/api/cases", timeout=10).json()
        assert self.CASE_ID not in [c["id"] for c in pub], "disabled case leaked to public list"
        # admin include_disabled returns it
        adm = requests.get(
            f"{BASE_URL}/api/admin/cases?include_disabled=true", headers=_auth(admin_token), timeout=10,
        ).json()
        assert self.CASE_ID in [c["id"] for c in adm]


# ---------------------------------------------------------------------------
# Phase 3a: Admin Items CRUD
# ---------------------------------------------------------------------------
class TestAdminItems:
    ITEM_SLUG = "test_item_3a"

    def test_search_pepe(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/items?search=pepe", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        items = r.json()
        slugs = [i["slug"] for i in items]
        assert "plush_pepe" in slugs
        pepe = next(i for i in items if i["slug"] == "plush_pepe")
        assert pepe.get("cases_using", 0) >= 1

    def test_create_item(self, admin_token):
        # cleanup if leftover
        requests.delete(f"{BASE_URL}/api/admin/items/{self.ITEM_SLUG}", headers=_auth(admin_token), timeout=10)
        r = requests.post(
            f"{BASE_URL}/api/admin/items", headers=_auth(admin_token),
            json={"slug": self.ITEM_SLUG, "name": "Test Item", "rarity": "rare", "floor_price_ton": 1.5},
            timeout=10,
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["slug"] == self.ITEM_SLUG
        assert body["rarity"] == "rare"

    def test_create_duplicate_409(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/items", headers=_auth(admin_token),
            json={"slug": self.ITEM_SLUG, "name": "dup", "rarity": "rare", "floor_price_ton": 1.0},
            timeout=10,
        )
        assert r.status_code == 409

    def test_patch_item(self, admin_token):
        r = requests.patch(
            f"{BASE_URL}/api/admin/items/{self.ITEM_SLUG}", headers=_auth(admin_token),
            json={"name": "Renamed Item"}, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Renamed Item"

    def test_delete_unused(self, admin_token):
        r = requests.delete(f"{BASE_URL}/api/admin/items/{self.ITEM_SLUG}", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text

    def test_delete_in_use_409(self, admin_token):
        # plush_pepe is in baskets => 409
        r = requests.delete(f"{BASE_URL}/api/admin/items/plush_pepe", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 409

    def test_refetch_fragment(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/items/plush_pepe/refetch-from-fragment",
            headers=_auth(admin_token), timeout=30,
        )
        # Could be 200 (fragment reachable) or 502 (sandbox-blocked). Accept either but assert shape.
        if r.status_code == 200:
            body = r.json()
            assert body["ok"] is True
            assert body["size_bytes"] > 1000
        else:
            assert r.status_code == 502, f"unexpected {r.status_code}: {r.text[:200]}"


# ---------------------------------------------------------------------------
# Phase 3a: Admin Settings
# ---------------------------------------------------------------------------
class TestAdminSettings:
    def test_get_has_all_fields(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        expected = {
            "use_live_portals_pricing", "portals_auth_data_set",
            "floor_watcher_enabled", "floor_watcher_interval_seconds",
            "auto_fulfill_enabled", "auto_fulfill_threshold_ton", "auto_fulfill_daily_cap_ton",
            "referral_bronze_pct", "referral_silver_pct", "referral_silver_threshold",
            "referral_gold_pct", "referral_gold_threshold",
            "self_referral_blocked", "max_referrals_per_day_per_user",
        }
        missing = expected - set(body.keys())
        assert not missing, f"settings missing fields: {missing}"
        assert isinstance(body["portals_auth_data_set"], bool)

    def test_patch_persists(self, admin_token):
        r = requests.patch(
            f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token),
            json={"auto_fulfill_threshold_ton": 5.0, "referral_gold_threshold": 30}, timeout=10,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token), timeout=10).json()
        assert abs(g["auto_fulfill_threshold_ton"] - 5.0) < 1e-6
        assert g["referral_gold_threshold"] == 30

    def test_patch_validation_422(self, admin_token):
        r = requests.patch(
            f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token),
            json={"floor_watcher_interval_seconds": 20}, timeout=10,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:200]}"

    def test_reset_defaults(self, admin_token):
        r = requests.patch(
            f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token),
            json={"auto_fulfill_threshold_ton": 0.0, "referral_gold_threshold": 50}, timeout=10,
        )
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Phase 3a: Portals
# ---------------------------------------------------------------------------
class TestAdminPortals:
    def test_paste_in_auth(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/portals/auth", headers=_auth(admin_token),
            json={"auth_data": "query_id=test&user=test&hash=abc&auth_date=1700000000"}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "fingerprint" in body and len(body["fingerprint"]) > 0
        assert body["length"] > 0
        # settings now shows set=true
        s = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(admin_token), timeout=10).json()
        assert s["portals_auth_data_set"] is True

    def test_portals_test_returns_structured(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/admin/portals/test", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Either reachable (ok=true) OR structured unreachable error
        assert "ok" in body
        if not body["ok"]:
            assert "error" in body
            assert "suggestion" in body
            assert "unreachable" in body["error"].lower() or "no auth" in body["error"].lower()


# ---------------------------------------------------------------------------
# Phase 3a: Referral ladder + self-referral block
# ---------------------------------------------------------------------------
class TestReferrals:
    def test_new_user_bronze(self):
        tg = NON_ADMIN_TG_BASE + 5
        tok = _login(tg, username=f"ref_{tg}")
        r = requests.get(f"{BASE_URL}/api/referrals/me", headers=_auth(tok), timeout=10)
        assert r.status_code == 200
        b = r.json()
        assert b["current_tier"] == "bronze"
        # next_tier silver (10)
        assert b.get("next_tier") in (None, "silver")
        if b.get("next_tier") == "silver":
            assert b.get("next_tier_threshold") == 10

    def test_self_referral_blocked(self):
        tg = NON_ADMIN_TG_BASE + 6
        tok = _login(tg, username=f"refer_self_{tg}")
        me = requests.get(f"{BASE_URL}/api/referrals/me", headers=_auth(tok), timeout=10).json()
        ref_code = me["ref_code"]
        r = requests.post(
            f"{BASE_URL}/api/internal/referrals/tag",
            headers={"X-Internal-Secret": INTERNAL_SECRET, "Content-Type": "application/json"},
            json={"telegram_id": tg, "ref_code": ref_code}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is False
        assert "self" in (body.get("reason") or "").lower()

    def test_normal_referral_tags(self):
        # referrer
        ref_tg = NON_ADMIN_TG_BASE + 7
        ref_tok = _login(ref_tg, username=f"referrer_{ref_tg}")
        ref_code = requests.get(f"{BASE_URL}/api/referrals/me", headers=_auth(ref_tok), timeout=10).json()["ref_code"]
        # new referee — different tg
        new_tg = NON_ADMIN_TG_BASE + 8
        r = requests.post(
            f"{BASE_URL}/api/internal/referrals/tag",
            headers={"X-Internal-Secret": INTERNAL_SECRET, "Content-Type": "application/json"},
            json={"telegram_id": new_tg, "ref_code": ref_code}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
