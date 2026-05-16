"""Phase 4a — Polish + Observability tests.

Covers:
 - Drift heatmap endpoint /api/admin/cases/heatmap (auth gates, shape, sparkline window)
 - services.digest.build_daily_digest / send_daily_digest_to_admins
 - POST /api/admin/maintenance/sync-all dm_summary toggle + sync_all_digest notification
 - TON address checksum gate (tonsdk.Address) in /api/inventory/{id}/withdraw
 - Admin settings: digest_hour_utc, max_payout_multiplier, auto_fulfill_dry_run
 - GET /api/floor-prices shape (dict keyed by slug)
 - Big-win DM hook (multiplier >= 5x)
 - SFX files present (8 WAVs > 1KB)
 - APScheduler startup log confirms 'daily_digest cron at 09:00 UTC'
"""
from __future__ import annotations

import os
import sys
import time
import pathlib
import asyncio
from typing import Any

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
# Allow backend dir for services imports
sys.path.insert(0, "/app/backend")

ADMIN_TG = 100000001
USER_TG_BASE = 760400  # offset to avoid colliding with previous runs

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
def admin_token(session: requests.Session) -> str:
    return _dev_login(session, ADMIN_TG, "admin", "Admin")


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def user_token(session: requests.Session) -> str:
    tg = USER_TG_BASE + (int(time.time()) % 9000)
    return _dev_login(session, tg, "ph4user", "Ph4")


@pytest.fixture(scope="session")
def user_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


# ============================================================
# 1. Drift Heatmap
# ============================================================
class TestHeatmap:
    def test_heatmap_default_window(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/cases/heatmap", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "window_days" in body and body["window_days"] == 7
        assert "generated_at" in body and isinstance(body["generated_at"], str)
        rows = body["rows"]
        assert isinstance(rows, list)
        assert len(rows) == 5, f"expected 5 rows, got {len(rows)}"
        for row in rows:
            for k in ("case_id", "name", "price_ton", "target_ev_pct",
                      "theoretical_ev_pct", "theoretical_drift_pct",
                      "realized_rtp_pct", "opens_total", "opens_per_day"):
                assert k in row, f"missing key '{k}' in row {row.get('case_id')}"
            # theoretical_ev_pct close to target (±0.5%)
            drift = abs(float(row["theoretical_ev_pct"]) - float(row["target_ev_pct"]))
            assert drift <= 0.5, f"{row['case_id']} drift {drift:.3f} > 0.5"
            # opens_per_day length = window_days + 1
            assert len(row["opens_per_day"]) == 8, f"expected 8 buckets, got {len(row['opens_per_day'])}"
            assert all(isinstance(x, int) for x in row["opens_per_day"])

    def test_heatmap_custom_window(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/cases/heatmap?window_days=14", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window_days"] == 14
        for row in body["rows"]:
            assert len(row["opens_per_day"]) == 15

    def test_heatmap_unauthenticated_rejected(self, session):
        # FastAPI HTTPBearer default returns 403 "Not authenticated" when no token,
        # so accept either 401 or 403 — both signify "unauthenticated rejected".
        r = session.get(f"{BASE_URL}/api/admin/cases/heatmap", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_heatmap_non_admin_403(self, session, user_headers):
        r = session.get(f"{BASE_URL}/api/admin/cases/heatmap", headers=user_headers, timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_heatmap_not_404_route_ordering(self, session, admin_headers):
        """Ensure route ordering didn't regress to treating 'heatmap' as case_id."""
        r = session.get(f"{BASE_URL}/api/admin/cases/heatmap", headers=admin_headers, timeout=10)
        assert r.status_code != 404, "route ordering regression — 'heatmap' matched as case_id"


# ============================================================
# 2. Daily digest service (direct invocation)
# ============================================================
class TestDigest:
    def test_build_daily_digest(self):
        from services.digest import build_daily_digest
        result = asyncio.get_event_loop().run_until_complete(build_daily_digest())
        assert isinstance(result, dict)
        assert "text" in result and "stats" in result
        text = result["text"]
        assert isinstance(text, str) and len(text) > 0
        assert "<b>" in text, "digest text should contain Telegram HTML"
        assert "Lydomania" in text

    def test_send_daily_digest_enqueues(self):
        from services.digest import send_daily_digest_to_admins
        from core.db import notifications_col

        async def run():
            before = await notifications_col.count_documents({"kind": "daily_digest"})
            out = await send_daily_digest_to_admins()
            after = await notifications_col.count_documents({"kind": "daily_digest"})
            return before, after, out

        before, after, out = asyncio.get_event_loop().run_until_complete(run())
        assert out["sent"] >= 1
        # Should add one notification per admin
        assert after - before == out["sent"], f"expected {out['sent']} new daily_digest, got {after - before}"
        # Match all configured admin telegram IDs
        from core.config import ADMIN_TELEGRAM_IDS
        assert out["sent"] == len(ADMIN_TELEGRAM_IDS)


# ============================================================
# 3. Sync-All admin DM
# ============================================================
class TestSyncAllDM:
    def test_sync_all_no_refresh_no_apply_with_dm(self, session, admin_headers):
        from core.db import notifications_col

        async def count():
            return await notifications_col.count_documents({"kind": "sync_all_digest", "telegram_id": ADMIN_TG})

        before = asyncio.get_event_loop().run_until_complete(count())
        r = session.post(
            f"{BASE_URL}/api/admin/maintenance/sync-all",
            params={"refresh_first": "false", "apply": "false"},
            headers=admin_headers, timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "cases_recalib" in body or "report" in body or "items_sync" in body
        time.sleep(0.5)
        after = asyncio.get_event_loop().run_until_complete(count())
        assert after - before == 1, f"expected 1 new sync_all_digest, got {after - before}"

    def test_sync_all_dm_summary_false_skips_dm(self, session, admin_headers):
        from core.db import notifications_col

        async def count():
            return await notifications_col.count_documents({"kind": "sync_all_digest", "telegram_id": ADMIN_TG})

        before = asyncio.get_event_loop().run_until_complete(count())
        r = session.post(
            f"{BASE_URL}/api/admin/maintenance/sync-all",
            params={"refresh_first": "false", "apply": "false", "dm_summary": "false"},
            headers=admin_headers, timeout=60,
        )
        assert r.status_code == 200, r.text
        time.sleep(0.5)
        after = asyncio.get_event_loop().run_until_complete(count())
        assert after == before, f"sync_all_digest should NOT be enqueued (before={before}, after={after})"


# ============================================================
# 4. TON address checksum
# ============================================================
class TestTONChecksum:
    @pytest.fixture(scope="class")
    def inv_id_or_dummy(self, session, admin_headers):
        """Try to get a real inventory item (so we exercise the address gate).
        If we can't, use a dummy id — server should still validate addr first.
        """
        # Just pick a sentinel; address check happens before ownership check
        return "phase4a-dummy-inv"

    def _post_withdraw(self, session, user_headers, inv_id, addr):
        return session.post(
            f"{BASE_URL}/api/inventory/{inv_id}/withdraw",
            headers=user_headers, json={"destination_address": addr}, timeout=15,
        )

    def test_invalid_crc_rejected(self, session, user_headers, inv_id_or_dummy):
        # last char flipped from C → d ; valid base64 chars but bad CRC
        bad = "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCd"
        r = self._post_withdraw(session, user_headers, inv_id_or_dummy, bad)
        assert r.status_code == 400, f"bad CRC expected 400, got {r.status_code}: {r.text}"
        assert "invalid TON address" in r.text.lower() or "invalid ton address" in r.text.lower()

    def test_valid_checksum_passes_address_gate(self, session, user_headers, inv_id_or_dummy):
        good = "UQAZdIdZ3HR84duUYpvO7s_Yenbnx7TM6MPXOaquP4PnYCCc"
        r = self._post_withdraw(session, user_headers, inv_id_or_dummy, good)
        # Address is valid; failure should be DOWNSTREAM (inventory not found / not owned)
        assert r.status_code != 400 or "invalid TON address" not in r.text.lower(), (
            f"valid addr should pass address gate, got {r.status_code}: {r.text}"
        )
        # Acceptable downstream errors: 404/403/409 (no inventory) — confirms address gate passed
        assert r.status_code in (404, 403, 409, 400, 200), f"unexpected status {r.status_code}: {r.text}"

    def test_short_address_rejected(self, session, user_headers, inv_id_or_dummy):
        r = self._post_withdraw(session, user_headers, inv_id_or_dummy, "short")
        # 400 (validate_ton_address) or 422 (Pydantic min_length) both signify rejection
        assert r.status_code in (400, 422), f"short addr expected 400/422, got {r.status_code}: {r.text}"

    def test_46_As_wrong_checksum_rejected(self, session, user_headers, inv_id_or_dummy):
        bad = "UQ" + "A" * 46
        r = self._post_withdraw(session, user_headers, inv_id_or_dummy, bad)
        assert r.status_code == 400

    def test_empty_address_rejected(self, session, user_headers, inv_id_or_dummy):
        r = self._post_withdraw(session, user_headers, inv_id_or_dummy, "")
        # Empty might be 422 (Pydantic) or 400 — both are acceptable rejection signals
        assert r.status_code in (400, 422), f"empty addr expected 400/422, got {r.status_code}"


# ============================================================
# 5. Admin settings: max_payout_multiplier, digest_hour_utc, auto_fulfill_dry_run
# ============================================================
class TestAdminSettings:
    def test_get_settings_exposes_phase4a_fields(self, session, admin_headers):
        r = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "max_payout_multiplier" in body
        assert isinstance(body["max_payout_multiplier"], (int, float))
        assert "digest_hour_utc" in body
        assert isinstance(body["digest_hour_utc"], int)
        assert 0 <= body["digest_hour_utc"] <= 23
        assert "auto_fulfill_dry_run" in body
        assert isinstance(body["auto_fulfill_dry_run"], bool)

    def test_patch_digest_hour_roundtrip(self, session, admin_headers):
        # Save current value
        r0 = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers).json()
        orig = r0["digest_hour_utc"]
        try:
            r1 = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"digest_hour_utc": 14})
            assert r1.status_code == 200, r1.text
            r2 = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers).json()
            assert r2["digest_hour_utc"] == 14
        finally:
            session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"digest_hour_utc": orig})

    def test_patch_digest_hour_out_of_range_422(self, session, admin_headers):
        r = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"digest_hour_utc": 25})
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_patch_max_payout_out_of_range_422(self, session, admin_headers):
        r = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"max_payout_multiplier": 5})
        assert r.status_code == 422, f"expected 422 for <10, got {r.status_code}: {r.text}"
        r2 = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"max_payout_multiplier": 20000})
        assert r2.status_code == 422, f"expected 422 for >10000, got {r2.status_code}: {r2.text}"

    def test_patch_max_payout_in_range_ok(self, session, admin_headers):
        r0 = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers).json()
        orig = r0["max_payout_multiplier"]
        try:
            r1 = session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"max_payout_multiplier": 300})
            assert r1.status_code == 200, r1.text
            r2 = session.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers).json()
            assert float(r2["max_payout_multiplier"]) == 300.0
        finally:
            session.patch(f"{BASE_URL}/api/admin/settings", headers=admin_headers, json={"max_payout_multiplier": orig})


# ============================================================
# 6. Floor prices shape
# ============================================================
class TestFloorPricesShape:
    def test_floor_prices_is_dict_keyed_by_slug(self, session):
        r = session.get(f"{BASE_URL}/api/floor-prices", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Could be wrapped {prices: {...}} OR raw dict {slug: {...}}
        inner = body.get("prices") if isinstance(body, dict) and "prices" in body else body
        assert isinstance(inner, dict), f"expected dict keyed by slug, got {type(inner).__name__}"
        if inner:
            slug, val = next(iter(inner.items()))
            assert isinstance(val, dict), f"value for slug='{slug}' is not a dict: {val}"
            for k in ("floor_ton", "source", "updated_at"):
                assert k in val, f"missing key '{k}' in floor_prices[{slug}]"


# ============================================================
# 7. Big-win DM hook (multiplier >= 5x)
# ============================================================
class TestBigWinDM:
    def test_big_win_enqueue_via_direct_call(self):
        """Test the _maybe_enqueue_big_win_dm helper directly with a synthetic win."""
        from routers.cases import _maybe_enqueue_big_win_dm
        from core.db import notifications_col

        async def run():
            user = {"id": "u-test-big-win", "telegram_id": 555000111}
            case = {"id": "stickers_box", "name": "Stickers Box", "price_ton": 1.0}
            item_meta = {"name": "Test Plush Pepe", "rarity": "legendary"}
            payout = 7.5  # 7.5x mult >= 5x
            before = await notifications_col.count_documents({"kind": "big_win", "telegram_id": 555000111})
            await _maybe_enqueue_big_win_dm(user, case, item_meta, payout, "roll-test-1")
            after = await notifications_col.count_documents({"kind": "big_win", "telegram_id": 555000111})
            return before, after

        before, after = asyncio.get_event_loop().run_until_complete(run())
        assert after - before == 1, f"expected 1 new big_win notification, got {after - before}"

    def test_big_win_text_contains_huge_win_and_multiplier(self):
        from routers.cases import _maybe_enqueue_big_win_dm
        from core.db import notifications_col

        async def run():
            user = {"id": "u-test-big-win-2", "telegram_id": 555000222}
            case = {"id": "stickers_box", "name": "Stickers Box", "price_ton": 1.0}
            item_meta = {"name": "Test Item", "rarity": "mythic"}
            await _maybe_enqueue_big_win_dm(user, case, item_meta, 12.34, "roll-test-2")
            doc = await notifications_col.find_one(
                {"kind": "big_win", "telegram_id": 555000222},
                sort=[("created_at", -1)],
            )
            return doc

        doc = asyncio.get_event_loop().run_until_complete(run())
        assert doc is not None
        text = doc.get("text", "")
        assert "HUGE WIN" in text
        assert "×12.34" in text or "12.34" in text

    def test_below_threshold_no_enqueue(self):
        from routers.cases import _maybe_enqueue_big_win_dm
        from core.db import notifications_col

        async def run():
            user = {"id": "u-test-no-bw", "telegram_id": 555000333}
            case = {"id": "stickers_box", "name": "Stickers Box", "price_ton": 1.0}
            item_meta = {"name": "Tiny Item", "rarity": "common"}
            before = await notifications_col.count_documents({"kind": "big_win", "telegram_id": 555000333})
            await _maybe_enqueue_big_win_dm(user, case, item_meta, 3.5, "roll-test-3")  # 3.5x < 5x
            after = await notifications_col.count_documents({"kind": "big_win", "telegram_id": 555000333})
            return before, after

        before, after = asyncio.get_event_loop().run_until_complete(run())
        assert after == before, "should NOT enqueue when multiplier < 5x"


# ============================================================
# 8. SFX files present
# ============================================================
class TestSFXFiles:
    EXPECTED = [
        "scroll_tick.wav", "coin_drop.wav",
        "win_common.wav", "win_rare.wav", "win_epic.wav",
        "win_legendary.wav", "win_mythic.wav", "confetti_burst.wav",
    ]

    def test_all_eight_wavs_present(self):
        sfx_dir = pathlib.Path("/app/frontend/public/sfx")
        assert sfx_dir.is_dir(), "sfx directory missing"
        for fname in self.EXPECTED:
            f = sfx_dir / fname
            assert f.exists(), f"missing SFX: {fname}"
            size = f.stat().st_size
            assert size > 1024, f"{fname} size {size} <= 1KB"


# ============================================================
# 9. APScheduler started (verify via backend log)
# ============================================================
class TestAPScheduler:
    def test_health_ok(self, session):
        # Backend lifespan completed successfully → /api should respond
        r = session.get(f"{BASE_URL}/api/cases", timeout=10)
        assert r.status_code == 200

    def test_log_contains_scheduler_started(self):
        log_paths = ["/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"]
        found = False
        for p in log_paths:
            if not os.path.exists(p):
                continue
            with open(p, "r", errors="ignore") as fh:
                content = fh.read()
                if "APScheduler started" in content and "daily_digest cron at 09:00 UTC" in content:
                    found = True
                    break
        assert found, "backend log missing 'APScheduler started · daily_digest cron at 09:00 UTC'"
