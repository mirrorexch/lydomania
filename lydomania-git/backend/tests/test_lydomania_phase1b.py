"""Phase 1b backend tests: batch open, referrals, share-card, internal API."""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "http://localhost:8001"
INTERNAL_SECRET = "lydo_internal_dev_secret_71fc28a04bdf1c9e5a3b2e6d8f0c1a4b"

# Unique tg ids per run
TS = int(time.time()) % 100000
REFERRER_TID = 800000 + TS
REFEREE_TID = 810000 + TS
OTHER_TID = 820000 + TS


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


# ---- Sanity Phase 0/1a ----
def test_health():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_cases():
    r = requests.get(f"{BASE_URL}/api/cases")
    assert r.status_code == 200
    cases = r.json()
    assert len(cases) == 5
    prices = sorted(c["price_ton"] for c in cases)
    assert prices == [10, 25, 50, 100, 250]


# ---- Internal API gating ----
class TestInternalGating:
    def test_missing_secret_401(self):
        r = requests.get(f"{BASE_URL}/api/internal/cases")
        assert r.status_code == 401

    def test_wrong_secret_401(self):
        r = requests.get(f"{BASE_URL}/api/internal/cases",
                         headers={"X-Internal-Secret": "wrong"})
        assert r.status_code == 401

    def test_correct_secret_cases(self):
        r = requests.get(f"{BASE_URL}/api/internal/cases",
                         headers={"X-Internal-Secret": INTERNAL_SECRET})
        assert r.status_code == 200
        cases = r.json()
        assert len(cases) == 5
        for c in cases:
            assert "id" in c and "name" in c and "price_ton" in c

    def test_balance_for_nonexistent_user(self):
        r = requests.get(f"{BASE_URL}/api/internal/user/{OTHER_TID + 99999}/balance",
                         headers={"X-Internal-Secret": INTERNAL_SECRET})
        assert r.status_code == 200
        assert r.json()["exists"] is False

    def test_deposit_intent_creates_user(self):
        new_tid = OTHER_TID + 12345
        r = requests.post(f"{BASE_URL}/api/internal/user/{new_tid}/deposit-intent",
                          headers={"X-Internal-Secret": INTERNAL_SECRET})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "address" in body and "memo" in body
        assert body["memo"].startswith("dep:")
        # Verify user was created
        b = requests.get(f"{BASE_URL}/api/internal/user/{new_tid}/balance",
                         headers={"X-Internal-Secret": INTERNAL_SECRET}).json()
        assert b["exists"] is True


# ---- Referral E2E ----
class TestReferralFlow:
    def test_full_referral_flow(self):
        # 1. Referrer login -> get ref_code
        ref_data = _login(REFERRER_TID, f"ref_{TS}")
        ref_tok = ref_data["token"]
        me = requests.get(f"{BASE_URL}/api/referrals/me", headers=_hdr(ref_tok))
        assert me.status_code == 200, me.text
        ref_me = me.json()
        ref_code = ref_me["ref_code"]
        assert ref_code and len(ref_code) == 8
        assert ref_me["ref_link"].startswith("https://t.me/")
        assert ref_me["referral_pct"] == 0.05
        assert ref_me["claimable_ton"] == 0.0

        # 2. Tag referee BEFORE they login (pending)
        tag = requests.post(
            f"{BASE_URL}/api/internal/referrals/tag",
            json={"telegram_id": REFEREE_TID, "ref_code": ref_code},
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )
        assert tag.status_code == 200, tag.text
        assert tag.json()["ok"] is True
        assert tag.json()["tagged_immediately"] is False

        # 3. Referee logs in -> pending consumed
        referee_data = _login(REFEREE_TID, f"refe_{TS}")
        referee_tok = referee_data["token"]
        _credit(referee_tok, 5000.0)

        # 4. Referee plays — single open
        cases = requests.get(f"{BASE_URL}/api/cases").json()
        case = next(c for c in cases if c["price_ton"] == 10)
        r = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open",
                          json={"client_seed": "test-seed"}, headers=_hdr(referee_tok))
        assert r.status_code == 200, r.text
        single_roll_id = r.json()["roll_id"]

        # 5. Referee batch open
        rb = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open-batch",
                           json={"client_seed": "batch-seed", "count": 10},
                           headers=_hdr(referee_tok))
        assert rb.status_code == 200, rb.text
        batch = rb.json()
        assert len(batch["rolls"]) == 10
        for roll in batch["rolls"]:
            assert "inventory_id" in roll
            assert "payout_ton" in roll
            assert "winning_item" in roll
        assert batch["total_paid_ton"] == 100.0  # 10 * 10
        assert "server_seed_hash" in batch
        assert "server_seed_revealed" in batch
        assert batch["net_pnl_ton"] == round(batch["total_won_ton"] - batch["total_paid_ton"], 9)

        # 6. Check referrer balance: 5% of (10 + 100) = 5.5
        me2 = requests.get(f"{BASE_URL}/api/referrals/me", headers=_hdr(ref_tok)).json()
        expected = round((10 + 100) * 0.05, 9)
        assert abs(me2["claimable_ton"] - expected) < 1e-6, f"got {me2['claimable_ton']} expected {expected}"
        assert abs(me2["total_earnings_ton"] - expected) < 1e-6
        assert me2["total_referrals_count"] == 1
        assert len(me2["recent_referrals"]) == 1
        assert "masked_username" in me2["recent_referrals"][0]
        masked = me2["recent_referrals"][0]["masked_username"]
        assert "*" in masked

        # Store info on the class for the next test
        TestReferralFlow.ref_tok = ref_tok
        TestReferralFlow.expected_claim = expected
        TestReferralFlow.single_roll_id = single_roll_id
        TestReferralFlow.referee_tok = referee_tok
        TestReferralFlow.batch_rolls = batch["rolls"]

    def test_claim_referral(self):
        ref_tok = TestReferralFlow.ref_tok
        expected = TestReferralFlow.expected_claim
        # Check pre-claim main balance
        me_pre = requests.get(f"{BASE_URL}/api/me", headers=_hdr(ref_tok)).json()
        pre_bal = me_pre["balance_ton"]

        c = requests.post(f"{BASE_URL}/api/referrals/claim", headers=_hdr(ref_tok))
        assert c.status_code == 200, c.text
        cj = c.json()
        assert abs(cj["claimed_ton"] - expected) < 1e-6
        assert abs(cj["new_main_balance"] - (pre_bal + expected)) < 1e-6
        assert cj["new_referral_balance"] == 0.0

        # Second claim -> 400
        c2 = requests.post(f"{BASE_URL}/api/referrals/claim", headers=_hdr(ref_tok))
        assert c2.status_code == 400


# ---- Batch Open verification ----
class TestBatchOpen:
    def test_insufficient_balance_402(self):
        # New user, no credit
        data = _login(OTHER_TID + 555, f"poor_{TS}")
        tok = data["token"]
        cases = requests.get(f"{BASE_URL}/api/cases").json()
        case = next(c for c in cases if c["price_ton"] == 10)
        r = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open-batch",
                          json={"client_seed": "x", "count": 10}, headers=_hdr(tok))
        assert r.status_code == 402

    def test_batch_rolls_verifiable(self):
        # Use referee's batch rolls
        rolls = TestReferralFlow.batch_rolls
        # Verify first roll
        rid = rolls[0]["roll_id"]
        v = requests.get(f"{BASE_URL}/api/fair/verify", params={"round_id": rid})
        assert v.status_code == 200, v.text
        assert v.json()["verified"] is True

    def test_batch_inventory_persisted(self):
        tok = TestReferralFlow.referee_tok
        inv = requests.get(f"{BASE_URL}/api/inventory", headers=_hdr(tok))
        assert inv.status_code == 200
        body = inv.json()
        # 1 single + 10 batch = 11 in_inventory
        in_inv = [i for i in body["items"] if i["status"] == "in_inventory"]
        assert len(in_inv) >= 11


# ---- Share Card ----
class TestShareCard:
    def test_share_card_unauthorized_roll_404(self):
        # Other user tries to share referee's roll
        data = _login(OTHER_TID + 777, f"other_{TS}")
        tok = data["token"]
        rid = TestReferralFlow.single_roll_id
        r = requests.post(f"{BASE_URL}/api/share-card/generate",
                          params={"roll_id": rid}, headers=_hdr(tok))
        assert r.status_code == 404

    def test_share_card_low_multiplier_400_or_success(self):
        # Try generating for first batch roll (probably <2x for most)
        tok = TestReferralFlow.referee_tok
        rolls = TestReferralFlow.batch_rolls
        # Find any roll with low multiplier
        # case price is 10
        low = [r for r in rolls if r["payout_ton"] / 10.0 < 2.0]
        high = [r for r in rolls if r["payout_ton"] / 10.0 >= 2.0]
        if low:
            rid = low[0]["roll_id"]
            r = requests.post(f"{BASE_URL}/api/share-card/generate",
                              params={"roll_id": rid}, headers=_hdr(tok))
            assert r.status_code == 400, f"expected 400 for low-mult roll, got {r.status_code}: {r.text}"
        # Test high mult success — keep credit-grinding until we get a >=2x win
        if not high:
            # Try a few more single opens to get a high mult win
            _credit(tok, 2000.0)
            cases = requests.get(f"{BASE_URL}/api/cases").json()
            case = next(c for c in cases if c["price_ton"] == 10)
            for _ in range(40):
                r = requests.post(f"{BASE_URL}/api/cases/{case['id']}/open",
                                  json={"client_seed": "h"}, headers=_hdr(tok))
                if r.status_code == 200 and r.json()["payout_ton"] / 10.0 >= 2.0:
                    high = [{"roll_id": r.json()["roll_id"], "payout_ton": r.json()["payout_ton"]}]
                    break
        if high:
            rid = high[0]["roll_id"]
            r = requests.post(f"{BASE_URL}/api/share-card/generate",
                              params={"roll_id": rid}, headers=_hdr(tok))
            assert r.status_code == 200, r.text
            body = r.json()
            assert "url" in body
            assert body["multiplier"] >= 2.0
            # Fetch PNG
            img = requests.get(f"{BASE_URL}{body['url']}" if body['url'].startswith("/") else body["url"])
            assert img.status_code == 200
            assert img.headers.get("content-type", "").startswith("image/")
            assert len(img.content) > 1000
            # Idempotent
            r2 = requests.post(f"{BASE_URL}/api/share-card/generate",
                               params={"roll_id": rid}, headers=_hdr(tok))
            assert r2.status_code == 200
            assert r2.json()["url"] == body["url"]
        else:
            pytest.skip("No >=2x win generated in test window (RNG-dependent)")
