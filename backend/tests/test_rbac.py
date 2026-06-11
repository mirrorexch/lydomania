"""RBAC — admin (full) vs support (read-only) access to the admin surface.

Run with: ENABLE_DEV_LOGIN=true ADMIN_TELEGRAM_IDS=100000001
          SUPPORT_TELEGRAM_IDS=100000777 pytest tests/test_rbac.py

Verifies:
- Full admin: read + write on /api/admin/*.
- Support (read-only): safe methods (GET) allowed, writes (PATCH/POST) → 403.
- Regular user: 403 on everything.
- Separately-mounted admin routers (gift-deposits, sell-reviews) honour the
  same rule: support may GET the queue, but not act on it.
"""
from __future__ import annotations

import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

ADMIN_TG = 100000001      # must be in ADMIN_TELEGRAM_IDS
SUPPORT_TG = 100000777    # must be in SUPPORT_TELEGRAM_IDS (and NOT admin)
USER_TG = 100009999       # neither


def _login(tg_id: int, username: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/dev-login",
        params={"telegram_id": tg_id, "username": username, "first_name": username},
        timeout=15,
    )
    assert r.status_code == 200, f"dev-login {tg_id}: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok() -> str:
    return _login(ADMIN_TG, "rbac_admin")


@pytest.fixture(scope="module")
def support_tok() -> str:
    return _login(SUPPORT_TG, "rbac_support")


@pytest.fixture(scope="module")
def user_tok() -> str:
    return _login(USER_TG, "rbac_user")


# ---- Full admin: read + write -------------------------------------------- #
def test_admin_can_read_settings(admin_tok):
    r = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(admin_tok), timeout=15)
    assert r.status_code == 200, r.text


def test_admin_can_write_settings(admin_tok):
    r = requests.patch(f"{BASE_URL}/api/admin/settings", json={}, headers=_auth(admin_tok), timeout=15)
    assert r.status_code == 200, r.text


# ---- Support: read-only --------------------------------------------------- #
def test_support_can_read_settings(support_tok):
    r = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(support_tok), timeout=15)
    assert r.status_code == 200, r.text


def test_support_can_read_withdrawals_queue(support_tok):
    r = requests.get(f"{BASE_URL}/api/admin/withdrawals", headers=_auth(support_tok), timeout=15)
    assert r.status_code == 200, r.text


def test_support_cannot_write_settings(support_tok):
    r = requests.patch(f"{BASE_URL}/api/admin/settings", json={}, headers=_auth(support_tok), timeout=15)
    assert r.status_code == 403, f"support must not write settings: {r.status_code} {r.text}"


def test_support_cannot_credit_user(support_tok):
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{USER_TG}/credit",
        json={"amount_ton": 1.0, "reason": "rbac-test"},
        headers=_auth(support_tok),
        timeout=15,
    )
    assert r.status_code == 403, f"support must not credit: {r.status_code} {r.text}"


def test_support_can_read_gift_deposits_queue(support_tok):
    r = requests.get(f"{BASE_URL}/api/admin/gift-deposits", headers=_auth(support_tok), timeout=15)
    assert r.status_code == 200, r.text


def test_support_cannot_reject_gift_deposit(support_tok):
    # Non-existent id: a full admin would get 404, support must be stopped at 403 first.
    r = requests.post(
        f"{BASE_URL}/api/admin/gift-deposits/nonexistent/reject",
        json={"reason": "x"},
        headers=_auth(support_tok),
        timeout=15,
    )
    assert r.status_code == 403, f"support must not reject: {r.status_code} {r.text}"


# ---- Regular user: denied ------------------------------------------------- #
def test_user_cannot_read_admin(user_tok):
    r = requests.get(f"{BASE_URL}/api/admin/settings", headers=_auth(user_tok), timeout=15)
    assert r.status_code == 403, r.text


def test_user_cannot_write_admin(user_tok):
    r = requests.patch(f"{BASE_URL}/api/admin/settings", json={}, headers=_auth(user_tok), timeout=15)
    assert r.status_code == 403, r.text
