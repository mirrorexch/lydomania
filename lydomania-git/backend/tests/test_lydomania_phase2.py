"""Phase 2 backend tests: admin auth, withdrawal flow, notifications outbox."""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "http://localhost:8001"
INTERNAL_SECRET = "lydo_internal_dev_secret_71fc28a04bdf1c9e5a3b2e6d8f0c1a4b"

ADMIN_TID = 100000001
TS = int(time.time()) % 100000
USER_TID = 300000 + TS
USER2_TID = 310000 + TS
NONADMIN_TID = 320000 + TS

VALID_UQ = "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"
VALID_EQ = "EQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"  # synthetic EQ-prefixed (regex-only check)


# ---------- helpers ----------
def _login(tid, uname):
    r = requests.post(f"{BASE_URL}/api/auth/dev-login",
                      params={"telegram_id": tid, "username": uname, "first_name": uname})
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _credit(tok, amt):
    r = requests.post(f"{BASE_URL}/api/wallet/dev-credit",
                      params={"amount": amt}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    return r.json()["balance_ton"]


def _open_case(tok, price=10):
    cases = requests.get(f"{BASE_URL}/api/cases").json()
    case = next(c for c in cases if c["price_ton"] == price)
    r = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open",
                      json={"client_seed": f"s{time.time()}"}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    return r.json()


def _get_in_inventory_item(tok):
    """Open until we get an in_inventory item and return its inv id."""
    inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(tok)).json()
    for it in inv.get("items", []):
        if it["status"] == "in_inventory":
            return it["id"]
    # else, open one
    _open_case(tok)
    inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(tok)).json()
    for it in inv.get("items", []):
        if it["status"] == "in_inventory":
            return it["id"]
    raise AssertionError("no in_inventory item")


# ---------- Regression sanity ----------
def test_health_regression():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200


def test_cases_list_regression():
    r = requests.get(f"{BASE_URL}/api/cases")
    assert r.status_code == 200
    assert len(r.json()) == 5


def test_single_open_regression():
    d = _login(USER_TID + 9000, f"reg_{TS}")
    tok = d["token"]
    _credit(tok, 200.0)
    res = _open_case(tok, 10)
    assert "roll_id" in res and "payout_ton" in res


def test_batch_open_regression():
    d = _login(USER_TID + 9001, f"reg2_{TS}")
    tok = d["token"]
    _credit(tok, 500.0)
    cases = requests.get(f"{BASE_URL}/api/cases").json()
    case = next(c for c in cases if c["price_ton"] == 10)
    r = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open-batch",
                      json={"client_seed": "rg", "count": 10}, headers=_hdr(tok))
    assert r.status_code == 200
    assert len(r.json()["rolls"]) == 10


def test_referrals_me_regression():
    d = _login(USER_TID + 9002, f"refrg_{TS}")
    r = requests.get(f"{BASE_URL}/api/referrals/me", headers=_hdr(d["token"]))
    assert r.status_code == 200
    assert "ref_code" in r.json()


# ---------- Admin Auth ----------
class TestAdminAuth:
    def test_admin_login_is_admin_true(self):
        d = _login(ADMIN_TID, "lydoadmin")
        assert d.get("user", {}).get("is_admin") is True
        me = requests.get(f"{BASE_URL}/api/me", headers=_hdr(d["token"])).json()
        assert me.get("is_admin") is True
        TestAdminAuth.admin_tok = d["token"]

    def test_nonadmin_login_is_admin_false(self):
        d = _login(NONADMIN_TID, f"nonadm_{TS}")
        assert d.get("user", {}).get("is_admin") is False
        me = requests.get(f"{BASE_URL}/api/me", headers=_hdr(d["token"])).json()
        assert me.get("is_admin") is False
        TestAdminAuth.user_tok = d["token"]

    def test_nonadmin_blocked_from_admin_route(self):
        r = requests.get(f"{BASE_URL}/api/admin/withdrawals",
                         headers=_hdr(TestAdminAuth.user_tok))
        assert r.status_code == 403, r.text
        assert "admin only" in r.text.lower()

    def test_admin_allowed(self):
        r = requests.get(f"{BASE_URL}/api/admin/withdrawals",
                         headers=_hdr(TestAdminAuth.admin_tok))
        assert r.status_code == 200, r.text


# ---------- Withdraw validation ----------
class TestWithdrawValidation:
    @classmethod
    def setup_class(cls):
        d = _login(USER_TID + 100, f"wval_{TS}")
        cls.tok = d["token"]
        _credit(cls.tok, 200.0)
        cls.inv_id = _get_in_inventory_item(cls.tok)

    def test_bad_address_400(self):
        r = requests.post(f"{BASE_URL}/api/inventory/{self.inv_id}/withdraw",
                          json={"destination_address": "not-a-real-addr"},
                          headers=_hdr(self.tok))
        assert r.status_code == 400, r.text
        assert "invalid" in r.text.lower()

    def test_missing_body_422(self):
        r = requests.post(f"{BASE_URL}/api/inventory/{self.inv_id}/withdraw",
                          json={}, headers=_hdr(self.tok))
        assert r.status_code == 422, r.text

    def test_valid_uq_success(self):
        r = requests.post(f"{BASE_URL}/api/inventory/{self.inv_id}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(self.tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "wid" in body or "id" in body
        wid = body.get("wid") or body.get("id")
        assert body.get("status") == "pending"
        TestWithdrawValidation.wid_uq = wid

    def test_second_withdraw_on_same_inv_409(self):
        r = requests.post(f"{BASE_URL}/api/inventory/{self.inv_id}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(self.tok))
        assert r.status_code == 409, r.text

    def test_valid_eq_success(self):
        # Need a fresh in_inventory item
        _credit(self.tok, 100.0)
        _open_case(self.tok, 10)
        inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(self.tok)).json()
        fresh = [i["id"] for i in inv["items"] if i["status"] == "in_inventory"]
        assert fresh, "need a fresh in_inventory item"
        r = requests.post(f"{BASE_URL}/api/inventory/{fresh[0]}/withdraw",
                          json={"destination_address": VALID_EQ},
                          headers=_hdr(self.tok))
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending"


# ---------- User Withdrawal E2E + Cancel ----------
class TestUserWithdrawalE2E:
    @classmethod
    def setup_class(cls):
        d = _login(USER_TID + 200, f"we2e_{TS}")
        cls.tok = d["token"]
        _credit(cls.tok, 200.0)
        cls.inv_id = _get_in_inventory_item(cls.tok)

    def test_full_flow(self):
        r = requests.post(f"{BASE_URL}/api/inventory/{self.inv_id}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(self.tok))
        assert r.status_code == 200, r.text
        wid = r.json().get("wid") or r.json().get("id")
        TestUserWithdrawalE2E.wid = wid

        # GET /api/withdrawals/me
        lst = requests.get(f"{BASE_URL}/api/withdrawals/me", headers=_hdr(self.tok))
        assert lst.status_code == 200, lst.text
        body = lst.json()
        items = body.get("items") if isinstance(body, dict) else body
        assert items and len(items) >= 1
        first = next((it for it in items if (it.get("id") or it.get("wid")) == wid), items[0])
        # required fields
        for f in ["item_name", "item_image_url", "item_rarity", "payout_ton",
                  "destination_address", "status", "requested_at", "item_slug"]:
            assert f in first, f"missing field {f} in {first.keys()}"
        assert first["status"] == "pending"
        assert first["destination_address"] == VALID_UQ

        # inventory item status
        inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(self.tok)).json()
        it = next(i for i in inv["items"] if i["id"] == self.inv_id)
        assert it["status"] == "withdraw_pending", f"got {it['status']}"

    def test_cancel_flow(self):
        wid = TestUserWithdrawalE2E.wid
        c = requests.post(f"{BASE_URL}/api/withdrawals/{wid}/cancel",
                          headers=_hdr(self.tok))
        assert c.status_code == 200, c.text
        assert c.json().get("status") == "cancelled"

        # Inventory restored
        inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(self.tok)).json()
        it = next(i for i in inv["items"] if i["id"] == self.inv_id)
        assert it["status"] == "in_inventory"

        # Second cancel -> 409
        c2 = requests.post(f"{BASE_URL}/api/withdrawals/{wid}/cancel",
                           headers=_hdr(self.tok))
        assert c2.status_code == 409, c2.text

    def test_cancel_other_user_withdrawal(self):
        # Create withdrawal as user A
        d2 = _login(USER2_TID + 200, f"we2e2_{TS}")
        tok2 = d2["token"]
        _credit(tok2, 100.0)
        inv_id2 = _get_in_inventory_item(tok2)
        r = requests.post(f"{BASE_URL}/api/inventory/{inv_id2}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(tok2))
        assert r.status_code == 200
        wid2 = r.json().get("wid") or r.json().get("id")
        # Try to cancel as a different user
        c = requests.post(f"{BASE_URL}/api/withdrawals/{wid2}/cancel",
                          headers=_hdr(self.tok))
        assert c.status_code in (404, 409), c.text


# ---------- Admin Queue Ops ----------
class TestAdminQueueOps:
    @classmethod
    def setup_class(cls):
        adm = _login(ADMIN_TID, "lydoadmin")
        cls.admin_tok = adm["token"]
        # create 3 separate users/withdrawals for start/fulfill/reject
        cls.withdrawals = []
        for i in range(3):
            d = _login(USER_TID + 400 + i, f"adm_q_{TS}_{i}")
            tok = d["token"]
            _credit(tok, 100.0)
            inv_id = _get_in_inventory_item(tok)
            r = requests.post(f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
                              json={"destination_address": VALID_UQ},
                              headers=_hdr(tok))
            assert r.status_code == 200, r.text
            wid = r.json().get("wid") or r.json().get("id")
            cls.withdrawals.append({"wid": wid, "tok": tok, "inv_id": inv_id})

    def test_start_pending(self):
        wid = self.withdrawals[0]["wid"]
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/start",
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "processing"
        # Start again -> 409
        r2 = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/start",
                           headers=_hdr(self.admin_tok))
        assert r2.status_code == 409

    def test_fulfill_from_processing(self):
        wid = self.withdrawals[0]["wid"]
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/fulfill",
                          json={"tx_hash": "abc" * 10, "fulfillment_value_ton": 5.5,
                                "gift_source": "portal"},
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "fulfilled"
        # Inventory should be 'withdrawn'
        inv = requests.get(f"{BASE_URL}/api/inventory",
                           headers=_hdr(self.withdrawals[0]["tok"])).json()
        it = next(i for i in inv["items"] if i["id"] == self.withdrawals[0]["inv_id"])
        assert it["status"] == "withdrawn", f"got {it['status']}"

    def test_fulfill_directly_from_pending(self):
        wid = self.withdrawals[1]["wid"]
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/fulfill",
                          json={"tx_hash": "def" * 10, "fulfillment_value_ton": 3.0,
                                "gift_source": "manual"},
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "fulfilled"

    def test_fulfill_bad_gift_source_422(self):
        # Use a new fresh withdrawal
        d = _login(USER_TID + 500, f"adm_bad_{TS}")
        tok = d["token"]
        _credit(tok, 100.0)
        inv_id = _get_in_inventory_item(tok)
        rr = requests.post(f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
                           json={"destination_address": VALID_UQ},
                           headers=_hdr(tok))
        wid = rr.json().get("wid") or rr.json().get("id")
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/fulfill",
                          json={"tx_hash": "x" * 10, "gift_source": "BOGUS"},
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 422, r.text

    def test_reject_short_reason_422(self):
        wid = self.withdrawals[2]["wid"]
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/reject",
                          json={"rejection_reason": "short"},
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 422, r.text

    def test_reject_valid_reason(self):
        wid = self.withdrawals[2]["wid"]
        reason = "Address looks suspicious; please verify."
        r = requests.post(f"{BASE_URL}/api/admin/withdrawals/{wid}/reject",
                          json={"rejection_reason": reason},
                          headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "rejected"
        # Inventory reverted
        inv = requests.get(f"{BASE_URL}/api/inventory",
                           headers=_hdr(self.withdrawals[2]["tok"])).json()
        it = next(i for i in inv["items"] if i["id"] == self.withdrawals[2]["inv_id"])
        assert it["status"] == "in_inventory", f"got {it['status']}"


# ---------- Admin List + Stats ----------
class TestAdminListStats:
    @classmethod
    def setup_class(cls):
        cls.admin_tok = _login(ADMIN_TID, "lydoadmin")["token"]

    def test_list_with_user_embed(self):
        r = requests.get(f"{BASE_URL}/api/admin/withdrawals",
                         headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list)
        if items:
            it = items[0]
            assert "user" in it
            u = it["user"]
            assert "telegram_id" in u
            assert "username" in u or "first_name" in u

    @pytest.mark.parametrize("status", ["pending", "processing", "fulfilled", "rejected", "all"])
    def test_list_status_filter(self, status):
        r = requests.get(f"{BASE_URL}/api/admin/withdrawals",
                         params={"status": status},
                         headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text

    def test_stats(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats/withdrawals",
                         headers=_hdr(self.admin_tok))
        assert r.status_code == 200, r.text
        s = r.json()
        for f in ["pending_count", "processing_count", "fulfilled_count",
                  "rejected_count", "cancelled_count", "total_value_pending_ton"]:
            assert f in s, f"missing {f}"
        assert "avg_fulfillment_seconds" in s


# ---------- Notifications Outbox ----------
class TestNotificationsOutbox:
    def test_pending_requires_secret(self):
        r = requests.get(f"{BASE_URL}/api/internal/notifications/pending")
        assert r.status_code == 401

    def test_pending_wrong_secret(self):
        r = requests.get(f"{BASE_URL}/api/internal/notifications/pending",
                         headers={"X-Internal-Secret": "wrong"})
        assert r.status_code == 401

    def test_pending_and_ack_success(self):
        # Trigger something that creates a notification: do a withdraw
        d = _login(USER_TID + 700, f"notif_{TS}")
        tok = d["token"]
        _credit(tok, 100.0)
        inv_id = _get_in_inventory_item(tok)
        r = requests.post(f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(tok))
        assert r.status_code == 200, r.text
        # Allow bot worker some time — but we'll poll directly
        time.sleep(0.5)
        # Poll the outbox a couple of times (worker may steal them every 2s)
        found = None
        for _ in range(5):
            p = requests.get(f"{BASE_URL}/api/internal/notifications/pending",
                             params={"limit": 50},
                             headers={"X-Internal-Secret": INTERNAL_SECRET})
            assert p.status_code == 200, p.text
            docs = p.json()
            assert isinstance(docs, list)
            if docs:
                found = docs[0]
                break
            time.sleep(0.5)
        if found is None:
            pytest.skip("All notifications drained by bot worker before test could observe")
        nid = found.get("id") or found.get("_id")
        assert nid
        # ACK success
        a = requests.post(f"{BASE_URL}/api/internal/notifications/ack",
                          json={"id": nid, "success": True},
                          headers={"X-Internal-Secret": INTERNAL_SECRET})
        assert a.status_code == 200, a.text

    def test_ack_failure(self):
        # create another notification by cancel
        d = _login(USER_TID + 800, f"notif2_{TS}")
        tok = d["token"]
        _credit(tok, 100.0)
        inv_id = _get_in_inventory_item(tok)
        r = requests.post(f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
                          json={"destination_address": VALID_UQ},
                          headers=_hdr(tok))
        wid = r.json().get("wid") or r.json().get("id")
        requests.post(f"{BASE_URL}/api/withdrawals/{wid}/cancel", headers=_hdr(tok))
        time.sleep(0.3)
        found = None
        for _ in range(5):
            p = requests.get(f"{BASE_URL}/api/internal/notifications/pending",
                             params={"limit": 50},
                             headers={"X-Internal-Secret": INTERNAL_SECRET})
            docs = p.json()
            if docs:
                found = docs[0]
                break
            time.sleep(0.5)
        if not found:
            pytest.skip("Worker drained queue too fast")
        nid = found.get("id") or found.get("_id")
        a = requests.post(f"{BASE_URL}/api/internal/notifications/ack",
                          json={"id": nid, "success": False, "error": "telegram: chat not found"},
                          headers={"X-Internal-Secret": INTERNAL_SECRET})
        assert a.status_code == 200, a.text
