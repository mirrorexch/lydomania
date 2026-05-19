"""Phase 6d — Case Battles WebSocket gateway.

Two channels:
    /api/ws/battles/lobby              — broadcasts lobby-wide events
    /api/ws/battles/{battle_id}        — per-battle channel

Auth via ?token=<JWT>. On connect, first frame = full snapshot.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Path, Query, WebSocket, WebSocketDisconnect, status

from core.auth import decode_jwt
from core.db import users_col
from services.battles import battles_col, hub, public_battle

LOG = logging.getLogger("lydomania.ws.battles")

router = APIRouter(tags=["battles-ws"])


async def _resolve_user(token: str) -> dict | None:
    try:
        payload = decode_jwt(token)
    except Exception:  # noqa: BLE001
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return await users_col.find_one(
        {"id": user_id}, {"_id": 0, "id": 1, "username": 1, "telegram_id": 1},
    )


async def _ws_loop(websocket: WebSocket, channel: str, snapshot_msg: dict) -> None:
    await websocket.accept()
    try:
        await websocket.send_json(snapshot_msg)
    except Exception:  # noqa: BLE001
        return
    q = hub.subscribe(channel)
    LOG.info("battles WS connected channel=%s subs=%d",
             channel, hub.subscribers(channel))
    try:
        while True:
            recv_task = asyncio.create_task(websocket.receive_text())
            send_task = asyncio.create_task(q.get())
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
        LOG.exception("battles WS crashed channel=%s", channel)
    finally:
        hub.unsubscribe(channel, q)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


@router.websocket("/api/ws/battles/lobby")
async def lobby_ws(
    websocket: WebSocket,
    token: str = Query(...),
) -> None:
    user = await _resolve_user(token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    cur = battles_col.find(
        {"status": {"$in": ["open", "ready", "rolling"]}},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)
    rows = [public_battle(d, full=False) async for d in cur]
    snapshot = {"type": "lobby_snapshot", "rows": rows}
    await _ws_loop(websocket, "lobby", snapshot)


@router.websocket("/api/ws/battles/{battle_id}")
async def battle_ws(
    websocket: WebSocket,
    battle_id: str = Path(..., min_length=4, max_length=64),
    token: str = Query(...),
) -> None:
    user = await _resolve_user(token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    snapshot = {"type": "snapshot", "battle": public_battle(doc, full=True)}
    await _ws_loop(websocket, battle_id, snapshot)
