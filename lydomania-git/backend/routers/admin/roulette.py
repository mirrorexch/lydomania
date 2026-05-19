"""Phase 6c — Admin roulette routes (stats + pause toggle)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import Body
from pydantic import BaseModel

from core.time_utils import iso, now
from routers.admin import admin
from services.roulette import bets_col, control_col, engine, rounds_col


class PauseIn(BaseModel):
    paused: bool


@admin.get("/roulette/stats")
async def roulette_stats() -> dict:
    """Last 24h: rounds, bets count, total wagered, total paid, realized RTP, by color."""
    cutoff = iso(now() - timedelta(hours=24))
    # Bets aggregation
    pipeline = [
        {"$match": {"placed_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$color",
            "wagered_ton": {"$sum": "$amount_ton"},
            "paid_ton": {"$sum": "$payout_ton"},
            "bet_count": {"$sum": 1},
            "won_count": {"$sum": {"$cond": [{"$eq": ["$status", "won"]}, 1, 0]}},
        }},
    ]
    by_color: dict[str, dict] = {}
    async for row in bets_col.aggregate(pipeline):
        c = row["_id"]
        by_color[c] = {
            "wagered_ton": round(float(row["wagered_ton"] or 0), 6),
            "paid_ton": round(float(row["paid_ton"] or 0), 6),
            "bet_count": int(row["bet_count"]),
            "won_count": int(row["won_count"]),
            "realized_rtp_pct": round(
                100 * float(row["paid_ton"] or 0)
                / max(float(row["wagered_ton"] or 0), 1e-9),
                2,
            ),
        }
    for c in ("red", "black", "green"):
        by_color.setdefault(c, {
            "wagered_ton": 0.0, "paid_ton": 0.0,
            "bet_count": 0, "won_count": 0, "realized_rtp_pct": 0.0,
        })

    total_wagered = sum(d["wagered_ton"] for d in by_color.values())
    total_paid = sum(d["paid_ton"] for d in by_color.values())
    total_bets = sum(d["bet_count"] for d in by_color.values())
    rounds_count = await rounds_col.count_documents({"ended_at": {"$gte": cutoff}})
    paused = bool(await control_col.find_one({"id": "control", "paused": True}))
    return {
        "window_hours": 24,
        "rounds": rounds_count,
        "bets": total_bets,
        "total_wagered_ton": round(total_wagered, 6),
        "total_paid_ton": round(total_paid, 6),
        "realized_rtp_pct": round(
            100 * total_paid / max(total_wagered, 1e-9), 2,
        ),
        "house_edge_pct": round(
            100 - 100 * total_paid / max(total_wagered, 1e-9), 2,
        ),
        "by_color": by_color,
        "ws_subscribers": engine.hub.size,
        "paused": paused,
        "current_round_id": (engine.current or {}).get("round_id"),
        "current_phase": (engine.current or {}).get("phase"),
    }


@admin.post("/roulette/pause")
async def roulette_pause(payload: PauseIn = Body(...)) -> dict:
    await control_col.update_one(
        {"id": "control"},
        {"$set": {"paused": bool(payload.paused), "updated_at": iso(now())}},
        upsert=True,
    )
    return {"paused": bool(payload.paused)}
