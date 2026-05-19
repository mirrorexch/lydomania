"""
Lydomania Phase 0 — Backend regression tests.

Coverage:
- /api/health, /api/openapi.json, /api/wallet/vault-info (public)
- /api/auth/telegram (invalid + empty initData)
- /api/auth/dev-login (happy path + JWT decode/claims)
- /api/me (auth + missing token)
- /api/wallet/deposit-address (unique memos)
- /api/wallet/dev-credit (happy path + validation)
- /api/wallet/balance (after dev-credit)
- /api/admin/portals/listings (mock fallback)
- Mongo persistence + deposit watcher log presence
"""

import os
import re
import time
from pathlib import Path

import jwt
import pymongo
import pytest
import requests
from dotenv import load_dotenv

# Load backend .env for JWT_SECRET / MONGO_URL / DB_NAME used in assertions
load_dotenv(Path("/app/backend/.env"))
# Load frontend .env for REACT_APP_BACKEND_URL (the external preview URL)
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
JWT_SECRET = os.environ["JWT_SECRET"]
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

EXPECTED_VAULT_UQ = "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"
EXPECTED_VAULT_EQ = "EQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYH1Z"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _dev_login(s, telegram_id: int, username: str, first_name: str) -> dict:
    r = s.post(
        f"{BASE_URL}/api/auth/dev-login",
        params={"telegram_id": telegram_id, "username": username, "first_name": first_name},
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------- PUBLIC -------------------------------------------------------------
class TestPublic:
    def test_health(self, s):
        r = s.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "ok"
        assert j["network"] == "mainnet"
        assert j["vault"] == EXPECTED_VAULT_UQ
        assert j["bot"] == "lydomania777_bot"
        assert j["dev_login_enabled"] is True

    def test_openapi(self, s):
        r = s.get(f"{BASE_URL}/api/openapi.json")
        assert r.status_code == 200
        spec = r.json()
        paths = spec.get("paths", {})
        expected = [
            "/api/health",
            "/api/wallet/vault-info",
            "/api/auth/telegram",
            "/api/auth/dev-login",
            "/api/me",
            "/api/wallet/deposit-address",
            "/api/wallet/balance",
            "/api/wallet/dev-credit",
            "/api/admin/portals/listings",
        ]
        for p in expected:
            assert p in paths, f"missing route in openapi: {p}"

    def test_vault_info(self, s):
        r = s.get(f"{BASE_URL}/api/wallet/vault-info")
        assert r.status_code == 200
        j = r.json()
        assert j["address"] == EXPECTED_VAULT_UQ
        assert j["address_bounceable"] == EXPECTED_VAULT_EQ
        assert j["network"] == "mainnet"
        # raw form like "0:..."
        assert re.match(r"^0:[0-9a-f]{64}$", j["address_raw"].lower()) is not None


# ---------- AUTH ---------------------------------------------------------------
class TestAuthTelegram:
    def test_invalid_initdata_hash(self, s):
        bad = "auth_date=1700000000&user=%7B%22id%22%3A1%7D&hash=deadbeef"
        r = s.post(f"{BASE_URL}/api/auth/telegram", json={"initData": bad})
        assert r.status_code == 401
        assert "hash" in r.json().get("detail", "").lower()

    def test_empty_initdata(self, s):
        r = s.post(f"{BASE_URL}/api/auth/telegram", json={"initData": ""})
        # Empty string has no hash → expect 401 "initData missing hash"
        assert r.status_code in (400, 401)
        if r.status_code == 401:
            assert "hash" in r.json().get("detail", "").lower()


class TestDevLogin:
    def test_dev_login_returns_token_and_user(self, s):
        body = _dev_login(s, 100001, "alpha", "Alpha")
        assert "token" in body and isinstance(body["token"], str) and body["token"]
        u = body["user"]
        assert u["telegram_id"] == 100001
        assert u["username"] == "alpha"
        assert u["first_name"] == "Alpha"
        assert "id" in u and isinstance(u["id"], str)
        assert isinstance(u["balance_ton"], float)

    def test_jwt_decodes_with_claims_and_24h_exp(self, s):
        body = _dev_login(s, 100002, "bravo", "Bravo")
        token = body["token"]
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        assert payload["sub"] == body["user"]["id"]
        assert payload["tid"] == 100002
        assert "exp" in payload and "iat" in payload
        # exp is ~24h from now
        delta = payload["exp"] - int(time.time())
        assert 23 * 3600 < delta <= 24 * 3600 + 60


class TestMe:
    def test_me_with_token(self, s):
        body = _dev_login(s, 100003, "admin_tester", "Admin")
        token = body["token"]
        r = s.get(f"{BASE_URL}/api/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        u = r.json()
        assert u["telegram_id"] == 100003
        assert u["id"] == body["user"]["id"]

    def test_me_without_token(self, s):
        # Use a clean session to avoid leaking auth header
        r = requests.get(f"{BASE_URL}/api/me")
        # HTTPBearer(auto_error=True) returns 403 when no creds
        assert r.status_code == 403


# ---------- DEPOSIT ADDRESS / DEV CREDIT --------------------------------------
class TestWallet:
    def test_deposit_address_returns_unique_memos(self, s):
        body = _dev_login(s, 100010, "depo_user", "Depo")
        token = body["token"]
        headers = {"Authorization": f"Bearer {token}"}
        r1 = s.get(f"{BASE_URL}/api/wallet/deposit-address", headers=headers)
        r2 = s.get(f"{BASE_URL}/api/wallet/deposit-address", headers=headers)
        assert r1.status_code == 200 and r2.status_code == 200
        j1, j2 = r1.json(), r2.json()
        # Memo format dep:<user_id>:<8-hex>
        for j in (j1, j2):
            assert j["address"] == EXPECTED_VAULT_UQ
            assert j["network"] == "mainnet"
            assert re.match(rf"^dep:{body['user']['id']}:[0-9a-f]{{8}}$", j["memo"])
            # expires_at must be > now and within ~1h+epsilon
            # parse ISO time
            from datetime import datetime, timezone
            exp_dt = datetime.fromisoformat(j["expires_at"])
            delta = (exp_dt - datetime.now(timezone.utc)).total_seconds()
            assert 3000 < delta <= 3700
        assert j1["memo"] != j2["memo"], "memo must be unique per call"

    def test_dev_credit_increments_balance(self, s, mongo):
        body = _dev_login(s, 100011, "credit_user", "Credit")
        token = body["token"]
        headers = {"Authorization": f"Bearer {token}"}
        # Initial balance must be 0 (fresh user)
        r0 = s.get(f"{BASE_URL}/api/wallet/balance", headers=headers)
        assert r0.status_code == 200
        assert r0.json()["balance_ton"] == 0.0

        r = s.post(f"{BASE_URL}/api/wallet/dev-credit", params={"amount": 25}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["balance_ton"] == 25.0

        # GET balance verifies persistence
        r2 = s.get(f"{BASE_URL}/api/wallet/balance", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["balance_ton"] == 25.0

        # Verify mongo doc inserted in deposits with credited=True
        dep = mongo["deposits"].find_one({"user_id": body["user"]["id"], "source": "dev-credit"})
        assert dep is not None
        assert dep["credited"] is True
        assert dep["amount_ton"] == 25.0

    def test_dev_credit_invalid_amount_422(self, s):
        body = _dev_login(s, 100012, "bad_credit", "Bad")
        token = body["token"]
        headers = {"Authorization": f"Bearer {token}"}
        r = s.post(f"{BASE_URL}/api/wallet/dev-credit", params={"amount": 0}, headers=headers)
        assert r.status_code == 422
        r2 = s.post(f"{BASE_URL}/api/wallet/dev-credit", params={"amount": -5}, headers=headers)
        assert r2.status_code == 422


# ---------- ADMIN PORTALS ------------------------------------------------------
class TestPortals:
    def test_portals_listings_returns_listings(self, s):
        r = s.get(f"{BASE_URL}/api/admin/portals/listings", params={"limit": 3})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "source" in j and "listings" in j
        assert isinstance(j["listings"], list)
        assert len(j["listings"]) <= 3
        assert j["source"] in ("mock", "portals")
        # Each listing has minimal shape
        if j["listings"]:
            it = j["listings"][0]
            assert "name" in it and "price_ton" in it


# ---------- PERSISTENCE / WATCHER ---------------------------------------------
class TestPersistenceAndWatcher:
    def test_mongo_collections_populated_and_no_objectid_leak(self, s, mongo):
        body = _dev_login(s, 100020, "persist_user", "Persist")
        token = body["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # users doc exists
        u = mongo["users"].find_one({"telegram_id": 100020})
        assert u is not None
        assert "_id" in u  # internal id exists in DB

        # The API response should NOT contain _id (we project it out)
        r_me = s.get(f"{BASE_URL}/api/me", headers=headers)
        assert "_id" not in r_me.json()

        # Trigger deposit-address → check intents
        r_da = s.get(f"{BASE_URL}/api/wallet/deposit-address", headers=headers)
        assert r_da.status_code == 200
        assert "_id" not in r_da.json()
        intent = mongo["deposit_intents"].find_one({"user_id": body["user"]["id"]})
        assert intent is not None
        assert intent["status"] == "pending"

        # Trigger dev-credit → check deposits
        r_dc = s.post(f"{BASE_URL}/api/wallet/dev-credit", params={"amount": 1.5}, headers=headers)
        assert r_dc.status_code == 200
        dep = mongo["deposits"].find_one({"user_id": body["user"]["id"]})
        assert dep is not None

    def test_deposit_watcher_started_log(self):
        # Look at the most recent backend log lines
        log_paths = [
            "/var/log/supervisor/backend.out.log",
            "/var/log/supervisor/backend.err.log",
        ]
        found_started = False
        found_polling = False
        for p in log_paths:
            if not os.path.exists(p):
                continue
            with open(p, "r", errors="ignore") as f:
                # Read tail
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 200_000))
                content = f.read()
            if "Deposit watcher started" in content:
                found_started = True
            if "toncenter.com/api/v2/getTransactions" in content or "Watcher cycle" in content:
                found_polling = True
        # Watcher started log MUST exist
        assert found_started, "Backend log does not contain 'Deposit watcher started'"
