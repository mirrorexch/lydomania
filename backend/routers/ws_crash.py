"""Phase 7a — Crash WebSocket gateway. WS URL: /api/ws/crash?token=<JWT>

Identical wire pattern to the Roulette WS (so the frontend can reuse the
plumbing); message types are: state | phase | tick | new_bet | cashout.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from core.auth import authenticate_ws
from core.db import users_col
from services.crash import engine

LOG = logging.getLogger("lydomania.ws.crash")

router = APIRouter(tags=["crash-ws"])




@router.websocket("/api/ws/crash")
async def crash_ws(websocket: WebSocket, token: str = Query(None)) -> None:
    # SECURITY: token comes from the first message frame (preferred) or the legacy
    # ?token= query param. authenticate_ws() accepts the socket before reading it.
    user = await authenticate_ws(websocket, token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        await websocket.send_json(engine.state_snapshot())
    except Exception:        # noqa: BLE001
        return
    queue = engine.hub.subscribe()
    LOG.info("crash WS connected · user=%s · hub_size=%d",
             user.get("username") or user["id"], engine.hub.size)
    try:
        while True:
            recv_task = asyncio.create_task(websocket.receive_text())
            send_task = asyncio.create_task(queue.get())
            done, pending = await asyncio.wait(
                {recv_task, send_task}, return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            if recv_task in done:
                try:
                    msg = recv_task.result()
                except (WebSocketDisconnect, RuntimeError):
                    break
                if msg == "ping":
                    await websocket.send_text("pong")
            if send_task in done:
                try:
                    payload = send_task.result()
                except asyncio.CancelledError:
                    continue
                await websocket.send_json(payload)
    except WebSocketDisconnect:
        pass
    except Exception:        # noqa: BLE001
        LOG.exception("crash WS crashed")
    finally:
        engine.hub.unsubscribe(queue)
        try:
            await websocket.close()
        except Exception:    # noqa: BLE001
            pass
