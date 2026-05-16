"""Phase 4b — Money + Retention tests.

Covers:
 - Admin promo CRUD (POST/GET/PATCH/DELETE /api/admin/promos)
 - POST /api/promo/redeem (WELCOME5 ton_bonus, FREESPIN free_spin_token, errors)
 - GET /api/cases/free_case/cooldown + POST /api/cases/free_case/open (+ batch reject)
 - GET /api/leaderboard/{view}?period=...
 - GET /api/admin/digest/preview + window_hours param
 - Sync-all regression (Phase 4a still wired)
 - Admin settings exposing portals_client_mode + mock_portals_*
 - services.ton_sender.build_nft_transfer_body + send_nft_transfer(dry_run=True)
 - services.auto_fulfill._attempt_buy_and_send(dry_run=True)
 - services.portals_client.get_portals_client() returns Mock when mode='mock'
 - services.leaderboard.snapshot_previous_week()
 - APScheduler 'weekly_leaderboard_snapshot Mon 00:05 UTC' log
"""
from __future__ import annotations

import os
import sys
import time
import asyncio
import secrets
from typing import Any

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
sys.path.insert(0, "/app/backend")

ADMIN_TG = 100000001
USER_TG_BASE = 770000  # avoid colliding


# ---------- fixtures ----------

@pytest.fixture(scope="session")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _dev_login(session: requests.Session, telegram_id: int, username: str = "tester", first_name: str = "Tester") -> str:
    r = session.post(
        f"{BASE_URL}/api/auth/dev-login",
        params={"telegram_id": telegram_id, "username": username, "first_name": first_name},
        timeout=20,
    )
    assert r.status_code == 200, f"dev-login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token(session): return _dev_login(session, ADMIN_TG, "admin", "Admin")


@pytest.fixture(scope="session")
def admin_headers(admin_token): return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _fresh_user(session) -> tuple[int, dict]:
    tg = USER_TG_BASE + secrets.randbelow(900000)
    tok = _dev_login(session, tg, f"u{tg}", "Tester")
    return tg, {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture
def fresh_user_headers(session):
    _, h = _fresh_user(session)
    return h


# ============================================================
# 1. Admin Promo CRUD
# ============================================================
class TestAdminPromosCRUD:
    @pytest.fixture(scope="class")
    def unique_code(self) -> str:
        return f"TEST_{secrets.token_hex(3).upper()}"

    def test_create_promo(self, session, admin_headers, unique_code):
        r = session.post(f"{BASE_URL}/api/admin/promos", headers=admin_headers, json={
            "code": unique_code, "type": "ton_bonus", "value": 1.5,
            "max_redemptions": 10, "user_max": 1, "enabled": True, "notes": "test",
        })
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["code"] == unique_code
        assert data["type"] == "ton_bonus"
        assert float(data["value"]) == 1.5

    def test_duplicate_returns_409(self, session, admin_headers, unique_code):
        r = session.post(f"{BASE_URL}/api/admin/promos", headers=admin_headers, json={
            "code": unique_code, "type": "ton_bonus", "value": 1.0,
        })
        assert r.status_code == 409, f"expected 409 dup, got {r.status_code}: {r.text}"

    def test_invalid_type_rejected(self, session, admin_headers):
        r = session.post(f"{BASE_URL}/api/admin/promos", headers=admin_headers, json={
            "code": f"BAD_{secrets.token_hex(3).upper()}", "type": "not_a_type", "value": 1.0,
        })
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_list_includes_seed_promos(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/promos", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body if isinstance(body, list) else body.get("rows", body.get("promos", []))
        codes = {row["code"] for row in rows}
        for seed in ("WELCOME5", "FREESPIN", "PHASE4B"):
            assert seed in codes, f"seed promo {seed} missing from list"

    def test_get_by_code_includes_recent_redemptions(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/promos/WELCOME5", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == "WELCOME5"
        assert "recent_redemptions" in body
        assert isinstance(body["recent_redemptions"], list)

    def test_patch_updates_value_enabled(self, session, admin_headers, unique_code):
        r = session.patch(f"{BASE_URL}/api/admin/promos/{unique_code}", headers=admin_headers,
                          json={"value": 2.5, "enabled": True})
        assert r.status_code == 200, r.text
        body = r.json()
        assert float(body["value"]) == 2.5
        assert body["enabled"] is True

    def test_delete_soft_disables(self, session, admin_headers, unique_code):
        r = session.delete(f"{BASE_URL}/api/admin/promos/{unique_code}", headers=admin_headers)
        assert r.status_code in (200, 204), r.text
        # Verify enabled=false
        g = session.get(f"{BASE_URL}/api/admin/promos/{unique_code}", headers=admin_headers)
        if g.status_code == 200:
            assert g.json().get("enabled") is False, "delete should soft-disable (enabled=false)"


# ============================================================
# 2. Promo redeem
# ============================================================
class TestPromoRedeem:
    def test_welcome5_credits_5_ton(self, session):
        _, h = _fresh_user(session)
        # snapshot balance
        me0 = session.get(f"{BASE_URL}/api/me", headers=h).json()
        bal0 = float(me0.get("balance_ton") or 0)
        r = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "WELCOME5"})
        assert r.status_code == 200, r.text
        me1 = session.get(f"{BASE_URL}/api/me", headers=h).json()
        bal1 = float(me1.get("balance_ton") or 0)
        assert abs((bal1 - bal0) - 5.0) < 0.01, f"expected +5 TON, got {bal1 - bal0}"

    def test_welcome5_second_attempt_rejected(self, session):
        _, h = _fresh_user(session)
        r1 = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "WELCOME5"})
        assert r1.status_code == 200
        r2 = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "WELCOME5"})
        assert r2.status_code == 400, f"expected 400 on dup, got {r2.status_code}: {r2.text}"
        assert "already" in r2.text.lower() or "redeemed" in r2.text.lower()

    def test_freespin_increments_token_up_to_3(self, session):
        _, h = _fresh_user(session)
        for i in range(3):
            r = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "FREESPIN"})
            assert r.status_code == 200, f"FREESPIN redeem #{i+1} failed: {r.status_code} {r.text}"
        me = session.get(f"{BASE_URL}/api/me", headers=h).json()
        # may be on me or queryable; check directly via cooldown
        cd = session.get(f"{BASE_URL}/api/cases/free_case/cooldown", headers=h).json()
        assert cd.get("free_spin_tokens", 0) >= 3, f"expected 3 tokens, got {cd}"
        # 4th attempt → 400
        r4 = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "FREESPIN"})
        assert r4.status_code == 400, f"expected 400 on user_max hit, got {r4.status_code}: {r4.text}"

    def test_unknown_code_rejected(self, session):
        _, h = _fresh_user(session)
        r = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "NOSUCHCODE_X9Z"})
        assert r.status_code in (400, 404), f"expected 400/404, got {r.status_code}: {r.text}"

    def test_disabled_code_rejected(self, session, admin_headers):
        code = f"DIS_{secrets.token_hex(3).upper()}"
        session.post(f"{BASE_URL}/api/admin/promos", headers=admin_headers, json={
            "code": code, "type": "ton_bonus", "value": 1.0, "enabled": False,
        })
        _, h = _fresh_user(session)
        r = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": code})
        assert r.status_code in (400, 404), f"expected 400/404 disabled, got {r.status_code}: {r.text}"
        # cleanup
        session.delete(f"{BASE_URL}/api/admin/promos/{code}", headers=admin_headers)


# ============================================================
# 3. Free case cooldown + open
# ============================================================
class TestFreeCase:
    def test_cooldown_brand_new_user_available(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/cases/free_case/cooldown", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("available", "seconds_remaining", "next_available_at", "free_spin_tokens"):
            assert k in body, f"missing key {k} in cooldown response: {body}"
        assert body["available"] is True
        assert int(body["seconds_remaining"]) == 0
        assert int(body["free_spin_tokens"]) == 0

    def test_first_open_succeeds(self, session):
        _, h = _fresh_user(session)
        r = session.post(f"{BASE_URL}/api/cases/free_case/open", headers=h, json={"client_seed": "test"})
        assert r.status_code == 200, f"free open: {r.status_code} {r.text}"
        # second consecutive call → 429 cooldown
        r2 = session.post(f"{BASE_URL}/api/cases/free_case/open", headers=h, json={"client_seed": "test"})
        assert r2.status_code == 429, f"expected 429 cooldown, got {r2.status_code}: {r2.text}"
        assert "cooldown" in r2.text.lower() or "free spin" in r2.text.lower()

    def test_freespin_token_bypasses_cooldown(self, session):
        _, h = _fresh_user(session)
        # first spin → success
        r1 = session.post(f"{BASE_URL}/api/cases/free_case/open", headers=h, json={"client_seed": "a"})
        assert r1.status_code == 200, r1.text
        # redeem FREESPIN for token
        rp = session.post(f"{BASE_URL}/api/promo/redeem", headers=h, json={"code": "FREESPIN"})
        assert rp.status_code == 200, rp.text
        # second spin while on cooldown should succeed by consuming the token
        r2 = session.post(f"{BASE_URL}/api/cases/free_case/open", headers=h, json={"client_seed": "b"})
        assert r2.status_code == 200, f"token bypass failed: {r2.status_code} {r2.text}"
        cd = session.get(f"{BASE_URL}/api/cases/free_case/cooldown", headers=h).json()
        assert int(cd.get("free_spin_tokens", 99)) == 0, f"token not consumed: {cd}"

    def test_batch_open_rejected_for_free_case(self, session):
        _, h = _fresh_user(session)
        r = session.post(f"{BASE_URL}/api/cases/free_case/open-batch", headers=h,
                         json={"client_seed": "x", "count": 3})
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert "one at a time" in r.text.lower() or "daily free" in r.text.lower()


# ============================================================
# 4. Leaderboards
# ============================================================
class TestLeaderboard:
    def test_wagered_week_shape(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/leaderboard/wagered?period=week&limit=10", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("view", "period", "rows", "me", "me_rank", "generated_at"):
            assert k in body, f"missing {k} in {body}"
        assert body["view"] == "wagered" and body["period"] == "week"
        rows = body["rows"]
        assert isinstance(rows, list)
        # sorted desc by value
        if len(rows) >= 2:
            vals = [float(r.get("value", 0)) for r in rows]
            assert vals == sorted(vals, reverse=True), f"rows not sorted desc: {vals}"

    def test_won_single_all(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/leaderboard/won_single?period=all", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["view"] == "won_single"
        rows = body.get("rows", [])
        if len(rows) >= 2:
            vals = [float(x.get("value", 0)) for x in rows]
            assert vals == sorted(vals, reverse=True)

    def test_referrers(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/leaderboard/referrers?period=all", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["view"] == "referrers"
        for row in body.get("rows", []):
            assert "extra" in row, f"referrers row missing 'extra': {row}"

    def test_invalid_view_400(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/leaderboard/not_a_view?period=week", headers=h)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_invalid_period_422(self, session):
        _, h = _fresh_user(session)
        r = session.get(f"{BASE_URL}/api/leaderboard/wagered?period=invalid", headers=h)
        assert r.status_code in (400, 422), f"expected 422, got {r.status_code}: {r.text}"


# ============================================================
# 5. Admin digest preview
# ============================================================
class TestAdminDigestPreview:
    def test_preview_default(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/digest/preview", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "text" in body and isinstance(body["text"], str) and len(body["text"]) > 0
        assert "stats" in body and isinstance(body["stats"], dict)

    def test_preview_window_param(self, session, admin_headers):
        for w in (6, 72):
            r = session.get(f"{BASE_URL}/api/admin/digest/preview?window_hours={w}",
                            headers=admin_headers, timeout=30)
            assert r.status_code == 200, f"window={w}: {r.text}"
            body = r.json()
            assert len(body["text"]) > 0


# ============================================================
# 6. Sync-all regression
# ============================================================
class TestSyncAllRegression:
    def test_sync_all_still_works_and_enqueues(self, session, admin_headers):
        from core.db import notifications_col

        async def count():
            return await notifications_col.count_documents(
                {"kind": "sync_all_digest", "telegram_id": ADMIN_TG}
            )

        before = asyncio.get_event_loop().run_until_complete(count())
        r = session.post(
            f"{BASE_URL}/api/admin/maintenance/sync-all",
            params={"refresh_first": "false", "apply": "false"},
            headers=admin_headers, timeout=90,
        )
        assert r.status_code == 200, r.text
        time.sleep(0.5)
        after = asyncio.get_event_loop().run_until_complete(count())
        assert after - before == 1, f"expected +1 sync_all_digest, got {after - before}"


# ============================================================
# 7. Admin settings — portals_client_mode + mock fields
# ============================================================
class TestAdminSettingsPortals:
    def test_settings_includes_portals_fields(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "portals_client_mode" in body
        assert body["portals_client_mode"] in ("mock", "real")
        assert "mock_portals_fail_rate" in body
        assert "mock_portals_sim_delay_s" in body

    def test_patch_mode_mock(self, session, admin_headers):
        r = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers,
                          json={"portals_client_mode": "mock"})
        assert r.status_code == 200, r.text
        g = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers).json()
        assert g["portals_client_mode"] == "mock"

    def test_patch_mode_invalid_422(self, session, admin_headers):
        r = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers,
                          json={"portals_client_mode": "BOGUS"})
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"


# ============================================================
# 8. ton_sender service-level
# ============================================================
class TestTonSender:
    VALID_OWNER = "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"

    def test_build_nft_transfer_body_returns_cell_with_op(self):
        from services.ton_sender import build_nft_transfer_body, NFT_TRANSFER_OP
        cell = build_nft_transfer_body(new_owner=self.VALID_OWNER, query_id=42)
        # Decode boc and verify op
        boc = cell.to_boc(False)
        assert len(boc) > 0
        # Op = first 32 bits big-endian of cell data
        data = cell.bits.get_top_upped_array()
        op = int.from_bytes(data[:4], "big")
        assert op == NFT_TRANSFER_OP, f"op got {hex(op)}, expected {hex(NFT_TRANSFER_OP)}"

    def test_send_dry_run_returns_drydry(self):
        from services.ton_sender import send_nft_transfer
        out = asyncio.get_event_loop().run_until_complete(
            send_nft_transfer(nft_address=self.VALID_OWNER, new_owner=self.VALID_OWNER, dry_run=True)
        )
        assert out.get("ok") is True
        assert out.get("mode") == "dry_run"
        assert isinstance(out.get("tx_hash"), str) and out["tx_hash"].startswith("drydry")
        assert isinstance(out.get("body_boc_b64"), str) and len(out["body_boc_b64"]) > 0


# ============================================================
# 9. auto_fulfill._attempt_buy_and_send dry-run
# ============================================================
class TestAutoFulfillDryRun:
    def test_dry_run_success_with_cheap_item(self):
        from services.auto_fulfill import _attempt_buy_and_send
        withdrawal = {
            "id": "w-test-4b",
            "item_slug": "homemade_cake",
            "destination_address": "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc",
            "payout_ton": 50.0,
        }
        ok, msg, diag = asyncio.get_event_loop().run_until_complete(
            _attempt_buy_and_send(withdrawal, dry_run=True)
        )
        assert ok is True, f"dry-run should succeed: msg={msg} diag={diag}"
        assert "DRY-RUN" in msg
        assert diag.get("resolved_listing") is not None
        assert diag.get("ton_send", {}).get("mode") == "dry_run"


# ============================================================
# 10. portals_client factory
# ============================================================
class TestPortalsClientFactory:
    def test_factory_returns_mock_when_mode_mock(self, session, admin_headers):
        # ensure mode = mock
        session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers,
                      json={"portals_client_mode": "mock"})
        from services.portals_client import get_portals_client, MockPortalsClient
        client = asyncio.get_event_loop().run_until_complete(get_portals_client())
        assert isinstance(client, MockPortalsClient), f"got {type(client).__name__}"


# ============================================================
# 11. snapshot_previous_week
# ============================================================
class TestLeaderboardSnapshot:
    def test_snapshot_writes_doc(self):
        from services.leaderboard import snapshot_previous_week
        from core.db import leaderboard_snapshots_col

        async def run():
            out = await snapshot_previous_week()
            doc = None
            if out and isinstance(out, dict) and out.get("id"):
                doc = await leaderboard_snapshots_col.find_one({"id": out["id"]})
            if doc is None:
                doc = await leaderboard_snapshots_col.find_one(sort=[("created_at", -1)])
            return out, doc

        out, doc = asyncio.get_event_loop().run_until_complete(run())
        assert out is not None, "snapshot returned None"
        assert doc is not None, "no snapshot doc found"
        assert str(doc.get("id", "")).startswith("weekly-"), f"id missing weekly- prefix: {doc.get('id')}"


# ============================================================
# 12. APScheduler weekly snapshot cron logged
# ============================================================
class TestSchedulerLog:
    def test_log_contains_weekly_snapshot(self):
        log_paths = ["/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"]
        for p in log_paths:
            if not os.path.exists(p):
                continue
            with open(p, "r", errors="ignore") as fh:
                if "weekly_leaderboard_snapshot" in fh.read():
                    return
        pytest.fail("backend log missing 'weekly_leaderboard_snapshot' scheduler entry")
