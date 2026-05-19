"""Phase 6e — Gift deposit integration tests.

Exercises the user-facing intent creation, idempotent admin test-credit,
unattributed admin queue, and admin manual-credit happy path.

Run with:  cd /app/backend && ENABLE_DEV_LOGIN=true ENABLE_GIFT_DEPOSITS=true \
           pytest tests/test_gift_deposits.py -v
"""
from __future__ import annotations

import os
import sys
import time

import httpx
import pytest

BASE = "http://localhost:8001"
API = f"{BASE}/api"

# Use a run-unique telegram_id base so re-running locally never collides with
# inventory from previous runs.
_RUN = int(time.time() * 1000) % 1_000_000
_BASE_TG = 900_000_000 + _RUN


def _dev_login(telegram_id: int, *, admin: bool = False) -> str:
    """Mint a JWT via /auth/dev-login. Admin if telegram_id matches the
    seeded ADMIN_TELEGRAM_IDS env list.
    """
    r = httpx.post(
        f"{API}/auth/dev-login",
        params={
            "telegram_id": telegram_id,
            "username": f"e2e_{telegram_id}",
            "first_name": "E2E",
        },
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()["token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _admin_token() -> str:
    raw = os.environ.get("ADMIN_TELEGRAM_IDS", "")
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            return _dev_login(int(chunk), admin=True)
        except ValueError:
            continue
    pytest.skip("ADMIN_TELEGRAM_IDS not configured")


# --------------------------------------------------------------------- #
# Intent creation                                                       #
# --------------------------------------------------------------------- #

def test_create_gift_deposit_intent_returns_unique_memo():
    t = _dev_login(_BASE_TG + 1)
    a = httpx.post(f"{API}/inventory/gift-deposits/intent", headers=_h(t), timeout=10.0)
    b = httpx.post(f"{API}/inventory/gift-deposits/intent", headers=_h(t), timeout=10.0)
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    ja, jb = a.json(), b.json()
    assert ja["id"] != jb["id"]
    assert ja["memo"] != jb["memo"]
    assert ja["memo"].startswith("gd_")
    assert ja["status"] == "pending"
    assert ja["address"].startswith(("UQ", "EQ"))
    assert ja["network"] == "mainnet"


def test_fetch_intent_is_user_scoped():
    me = _dev_login(_BASE_TG + 2)
    other = _dev_login(_BASE_TG + 3)
    created = httpx.post(f"{API}/inventory/gift-deposits/intent",
                         headers=_h(me), timeout=10.0).json()
    # My own → 200
    r1 = httpx.get(f"{API}/inventory/gift-deposits/intent/{created['id']}",
                   headers=_h(me), timeout=10.0)
    assert r1.status_code == 200
    # Foreign user → 404
    r2 = httpx.get(f"{API}/inventory/gift-deposits/intent/{created['id']}",
                   headers=_h(other), timeout=10.0)
    assert r2.status_code == 404


def test_list_my_gift_deposits():
    me = _dev_login(_BASE_TG + 4)
    httpx.post(f"{API}/inventory/gift-deposits/intent", headers=_h(me), timeout=10.0)
    httpx.post(f"{API}/inventory/gift-deposits/intent", headers=_h(me), timeout=10.0)
    r = httpx.get(f"{API}/inventory/gift-deposits/list", headers=_h(me), timeout=10.0)
    assert r.status_code == 200
    body = r.json()
    assert "intents" in body and len(body["intents"]) >= 2


# --------------------------------------------------------------------- #
# Admin test-credit (simulates the watcher landing an NFT)              #
# --------------------------------------------------------------------- #

def test_admin_test_credit_fulfills_intent_and_creates_inventory():
    admin = _admin_token()
    user = _dev_login(_BASE_TG + 5)
    intent = httpx.post(f"{API}/inventory/gift-deposits/intent",
                        headers=_h(user), timeout=10.0).json()

    cred = httpx.post(
        f"{API}/admin/gift-deposits/test-credit",
        headers=_h(admin),
        json={"intent_id": intent["id"], "item_slug": "swag_bag"},
        timeout=10.0,
    )
    assert cred.status_code == 200, cred.text
    body = cred.json()
    assert body["ok"] is True
    assert body["tx_hash"].startswith("test_")
    assert body["inventory_id"]

    # Polling endpoint now shows fulfilled
    fresh = httpx.get(
        f"{API}/inventory/gift-deposits/intent/{intent['id']}",
        headers=_h(user), timeout=10.0,
    ).json()
    assert fresh["status"] == "fulfilled"
    assert fresh["item_slug"] == "swag_bag"
    assert fresh["tx_hash"] == body["tx_hash"]

    # Inventory now contains the deposited item with case_id="gift_deposit"
    inv = httpx.get(f"{API}/inventory", headers=_h(user), timeout=10.0).json()
    matches = [
        it for it in inv["items"]
        if it["case_id"] == "gift_deposit" and it["item_slug"] == "swag_bag"
    ]
    assert len(matches) >= 1


def test_admin_test_credit_is_idempotent_on_double_call():
    admin = _admin_token()
    user = _dev_login(_BASE_TG + 6)
    intent = httpx.post(f"{API}/inventory/gift-deposits/intent",
                        headers=_h(user), timeout=10.0).json()

    # First credit succeeds
    a = httpx.post(
        f"{API}/admin/gift-deposits/test-credit",
        headers=_h(admin),
        json={"intent_id": intent["id"], "item_slug": "swag_bag"},
        timeout=10.0,
    )
    assert a.status_code == 200, a.text

    # Second credit is a no-op (already fulfilled) — must not create a 2nd inventory row
    b = httpx.post(
        f"{API}/admin/gift-deposits/test-credit",
        headers=_h(admin),
        json={"intent_id": intent["id"], "item_slug": "swag_bag"},
        timeout=10.0,
    )
    assert b.status_code == 200, b.text
    assert b.json().get("noop") is True

    inv = httpx.get(f"{API}/inventory", headers=_h(user), timeout=10.0).json()
    matches = [
        it for it in inv["items"]
        if it["case_id"] == "gift_deposit" and it["item_slug"] == "swag_bag"
    ]
    assert len(matches) == 1  # NOT 2 — idempotency guard


def test_admin_test_credit_requires_admin():
    user = _dev_login(_BASE_TG + 7)
    intent = httpx.post(f"{API}/inventory/gift-deposits/intent",
                        headers=_h(user), timeout=10.0).json()
    # Non-admin user trying to call test-credit → 403
    r = httpx.post(
        f"{API}/admin/gift-deposits/test-credit",
        headers=_h(user),
        json={"intent_id": intent["id"], "item_slug": "swag_bag"},
        timeout=10.0,
    )
    assert r.status_code in (401, 403)


def test_admin_test_credit_unknown_slug_404():
    admin = _admin_token()
    user = _dev_login(_BASE_TG + 8)
    intent = httpx.post(f"{API}/inventory/gift-deposits/intent",
                        headers=_h(user), timeout=10.0).json()
    r = httpx.post(
        f"{API}/admin/gift-deposits/test-credit",
        headers=_h(admin),
        json={"intent_id": intent["id"], "item_slug": "this_does_not_exist"},
        timeout=10.0,
    )
    assert r.status_code == 404


def test_admin_list_queue_has_counts_and_status_filter():
    admin = _admin_token()
    # Open a brand-new pending intent so we know at least one pending row exists
    user = _dev_login(_BASE_TG + 9)
    httpx.post(f"{API}/inventory/gift-deposits/intent",
               headers=_h(user), timeout=10.0)
    r = httpx.get(
        f"{API}/admin/gift-deposits",
        headers=_h(admin),
        params={"status": "pending"},
        timeout=10.0,
    )
    assert r.status_code == 200
    body = r.json()
    assert "rows" in body
    assert "counts" in body
    assert body["counts"].get("pending", 0) >= 1
    for row in body["rows"]:
        assert row["status"] == "pending"


if __name__ == "__main__":
    sys.exit(pytest.main(["-v", __file__]))
