"""
Lydomania smoke test (Phase 3b).

Catches the kind of refactor regression the testing agent found in Phase 3a:
- /api/fair/current returns server_seed_hash + nonce
- POST /api/cases/{id}/open returns a roll with server_seed_revealed
- /api/fair/verify recomputes the same roll_float → contracts intact

Run:
    pytest tests/smoke_test.py
or
    python -m tests.smoke_test
"""
from __future__ import annotations

import os
import sys
import time
import httpx

BACKEND = os.environ.get("LYDO_BACKEND_URL", "http://localhost:8001")


def _post(path: str, **kwargs) -> dict:
    r = httpx.post(f"{BACKEND}{path}", timeout=15.0, **kwargs)
    r.raise_for_status()
    return r.json()


def _get(path: str, **kwargs) -> dict:
    r = httpx.get(f"{BACKEND}{path}", timeout=15.0, **kwargs)
    r.raise_for_status()
    return r.json()


def _smoke_tg_id() -> int:
    # Reserve a fresh-ish id so concurrent CI runs don't collide
    return 990_000_000 + (int(time.time()) % 1_000_000)


def test_health():
    r = httpx.get(f"{BACKEND}/api/health", timeout=8.0)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "ok"


def test_fair_open_verify_chain():
    tg = _smoke_tg_id()
    auth = _post(f"/api/auth/dev-login?telegram_id={tg}&username=smoke")
    token = auth["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Credit some balance
    _post(f"/api/wallet/dev-credit?amount=20", headers=headers)

    # Fair state
    fair = _get("/api/fair/current", headers=headers)
    assert "server_seed_hash" in fair, fair
    assert isinstance(fair["nonce"], int)

    # List cases — must include at least one enabled
    cases = _get("/api/cases")
    assert isinstance(cases, list) and cases, cases
    cheapest = min(cases, key=lambda c: c["price_ton"])

    # Open
    roll = _post(
        f"/api/cases/{cheapest['id']}/open",
        json={"client_seed": "smokeseed"},
        headers=headers,
    )
    assert roll["winning_item"]["slug"], roll
    assert "server_seed_revealed" in roll
    assert "roll_float" in roll

    # Verify the same parameters reproduce the roll
    v = _get(
        "/api/fair/verify",
        params={
            "server_seed": roll["server_seed_revealed"],
            "client_seed": roll["client_seed"],
            "nonce": roll["nonce"],
        },
    )
    assert abs(v["roll_float"] - roll["roll_float"]) < 1e-9, (v, roll)
    assert v["server_seed_hash"] == roll["server_seed_hash"]


def test_floor_prices_public_endpoint_shape():
    """Confirms the endpoint exists and returns a dict (may be empty if watcher hasn't run)."""
    r = httpx.get(f"{BACKEND}/api/floor-prices", timeout=8.0)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict), data


def main():
    failed = []
    for name, fn in [
        ("health", test_health),
        ("fair_open_verify_chain", test_fair_open_verify_chain),
        ("floor_prices_public", test_floor_prices_public_endpoint_shape),
    ]:
        try:
            fn()
            print(f"  ✓ {name}")
        except Exception as e:
            print(f"  ✗ {name}: {e}")
            failed.append(name)
    if failed:
        print(f"\nFAILED: {failed}")
        sys.exit(1)
    print("\nAll smoke tests pass.")


if __name__ == "__main__":
    main()
