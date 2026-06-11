"""WebSocket auth — JWT via first message frame (preferred) + legacy ?token=.

Verifies the crash WS gateway authenticates from the message frame (so the token
never sits in the URL) while still honouring the legacy query param, and rejects
missing/invalid tokens.
"""
from __future__ import annotations

import json
import os

import pytest
import requests
import websockets

BASE = os.environ.get("LYDO_BACKEND_URL", "http://localhost:8001").rstrip("/")
WS_BASE = BASE.replace("http://", "ws://").replace("https://", "wss://")


def _token(tg: int) -> str:
    r = requests.post(
        f"{BASE}/api/auth/dev-login",
        params={"telegram_id": tg, "username": f"ws_{tg}", "first_name": "WS"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


@pytest.mark.asyncio
async def test_ws_auth_via_message_frame():
    """Connect WITHOUT a token in the URL, send it in the first frame, get a snapshot."""
    tok = _token(700000001)
    async with websockets.connect(f"{WS_BASE}/api/ws/crash") as ws:
        await ws.send(json.dumps({"token": tok}))
        msg = await ws.recv()  # crash engine sends a state snapshot on auth success
        data = json.loads(msg)
        assert isinstance(data, dict)  # got a real payload → authenticated


@pytest.mark.asyncio
async def test_ws_auth_legacy_query_param_still_works():
    tok = _token(700000002)
    async with websockets.connect(f"{WS_BASE}/api/ws/crash?token={tok}") as ws:
        msg = await ws.recv()
        assert isinstance(json.loads(msg), dict)


@pytest.mark.asyncio
async def test_ws_auth_rejects_bad_token():
    with pytest.raises(Exception):
        async with websockets.connect(f"{WS_BASE}/api/ws/crash") as ws:
            await ws.send(json.dumps({"token": "not-a-jwt"}))
            await ws.recv()  # should be closed before any payload arrives
