"""Phase 6c — Roulette WebSocket gateway.

WS endpoint: /api/ws/roulette?token=<JWT>

On connect:
    1) Validate JWT (same as REST)
    2) Push current state snapshot
    3) Subscribe to broadcast hub — forward every event

Client → server messages are ignored for now (read-only stream).
Read-only stream is enough; bets go through REST so we get HTTP-level
backpressure + idempotency + retries.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from core.auth import authenticate_ws
from core.db import users_col
from services.roulette import engine

LOG = logging.getLogger("lydomania.ws.roulette")

router = APIRouter(tags=["roulette-ws"])


@router.websocket("/api/ws/roulette")
async def roulette_ws(
    websocket: WebSocket,
    token: str = Query(None),
) -> None:
    # SECURITY: token via first frame (preferred) or legacy ?token=. See authenticate_ws.
    user = await authenticate_ws(websocket, token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    # Initial snapshot
    try:
        await websocket.send_json(engine.state_snapshot())
    except Exception:  # noqa: BLE001
        return
    queue = engine.hub.subscribe()
    LOG.info("roulette WS connected · user=%s · hub_size=%d",
             user.get("username") or user["id"], engine.hub.size)
    try:
        while True:
            # Drain any client → server pings to keep WS alive, but don't block on them.
            recv_task = asyncio.create_task(websocket.receive_text())
            send_task = asyncio.create_task(queue.get())
            done, pending = await asyncio.wait(
                {recv_task, send_task},
                return_when=asyncio.FIRST_COMPLETED,
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
    except Exception:  # noqa: BLE001
        LOG.exception("roulette WS crashed")
    finally:
        engine.hub.unsubscribe(queue)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
