"""Phase 8 — Live Activity REST + WebSocket routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from core.auth import get_current_user
from services.activity import hub, recent, top_24h, jackpot_24h

router = APIRouter(prefix="/api", tags=["activity"])


@router.get("/activity/recent")
async def get_recent(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),  # noqa: ARG001
) -> dict:
    rows = await recent(limit=limit)
    return {"rows": rows}


@router.get("/activity/top-24h")
async def get_top_24h(
    filter: str = Query("all", pattern=r"^(all|big_mult|big_payout|game:[a-z_]+)$"),
    limit: int = Query(24, ge=1, le=100),
    user: dict = Depends(get_current_user),  # noqa: ARG001
) -> dict:
    """Phase 11 / Fix-K — Top wins in the last 24h.

    Filter values:
      • `all`         — no filter
      • `big_mult`    — multiplier ≥ 5×
      • `big_payout`  — payout_ton ≥ 10
      • `game:<slug>` — single-game (wheel, plinko, mines, crash, roulette,
                       battles, cases…)
    """
    game_slug = None
    filter_mode = filter
    if filter.startswith("game:"):
        game_slug = filter.split(":", 1)[1]
        filter_mode = "all"
    rows = await top_24h(limit=limit, filter_mode=filter_mode, game_slug=game_slug)
    return {"rows": rows, "filter": filter, "count": len(rows)}


@router.get("/activity/jackpot-24h")
async def get_jackpot_24h(
    user: dict = Depends(get_current_user),  # noqa: ARG001
) -> dict:
    """Phase 11.1 — Sum of payout_ton across all live_activity events in the
    last 24h. Drives the home hero "TODAY'S JACKPOT" counter.

    Cached 5s in-memory so the WS-driven re-fetch on every event tick
    does not hammer Mongo.
    """
    return await jackpot_24h()


@router.websocket("/ws/activity")
async def ws_activity(ws: WebSocket):
    """No auth (public feed of anonymized winners)."""
    await ws.accept()
    await hub.connect(ws)
    try:
        # Send last 10 as hello payload so the UI hydrates immediately
        seed = await recent(limit=10)
        await ws.send_json({"type": "hello", "rows": seed})
        while True:
            # We don't expect client messages; reading keeps the connection alive
            # and lets us detect a clean disconnect.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.disconnect(ws)
