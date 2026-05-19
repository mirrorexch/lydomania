"""Phase 6d — Admin Case Battles routes."""

from __future__ import annotations

from datetime import timedelta

from fastapi import Body, HTTPException, Path
from pydantic import BaseModel, Field

from core.battles_engine import HOUSE_RAKE_DEFAULT_PCT, HOUSE_RAKE_MAX_PCT, clamp_rake
from core.time_utils import iso, now
from routers.admin import admin
from services.battles import BattleError, battles_col, battles_control_col, force_cancel


class RakeIn(BaseModel):
    rake_pct: float = Field(..., ge=0, le=HOUSE_RAKE_MAX_PCT)


@admin.get("/battles/stats")
async def battles_stats() -> dict:
    cutoff = iso(now() - timedelta(hours=24))
    completed = await battles_col.count_documents(
        {"status": "completed", "completed_at": {"$gte": cutoff}},
    )
    open_ = await battles_col.count_documents({"status": "open"})
    rolling = await battles_col.count_documents({"status": {"$in": ["ready", "rolling"]}})
    cancelled = await battles_col.count_documents(
        {"status": "cancelled", "completed_at": {"$gte": cutoff}},
    )

    pipeline = [
        {"$match": {"status": "completed", "completed_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": {"mode": "$mode", "players": "$players"},
            "battles": {"$sum": 1},
            "pot_ton": {"$sum": "$pot_ton"},
            "payout_ton": {"$sum": {"$multiply": [
                "$payout_per_winner_ton",
                {"$size": {"$ifNull": ["$winner_seat_indices", []]}},
            ]}},
            "rake_ton": {"$sum": {"$subtract": [
                "$pot_ton",
                {"$multiply": [
                    "$payout_per_winner_ton",
                    {"$size": {"$ifNull": ["$winner_seat_indices", []]}},
                ]},
            ]}},
        }},
    ]
    by_mode: list[dict] = []
    total_pot = 0.0
    total_rake = 0.0
    async for row in battles_col.aggregate(pipeline):
        m = row["_id"]
        by_mode.append({
            "mode": m["mode"],
            "players": int(m["players"]),
            "battles": int(row["battles"]),
            "pot_ton": round(float(row["pot_ton"]), 4),
            "payout_ton": round(float(row["payout_ton"] or 0), 4),
            "rake_ton": round(float(row["rake_ton"] or 0), 4),
        })
        total_pot += float(row["pot_ton"] or 0)
        total_rake += float(row["rake_ton"] or 0)

    rake_pct = await battles_control_col.find_one(
        {"id": "control"}, {"_id": 0, "rake_pct": 1},
    )
    current_rake = float(rake_pct["rake_pct"]) if rake_pct and "rake_pct" in rake_pct else HOUSE_RAKE_DEFAULT_PCT
    return {
        "window_hours": 24,
        "completed_24h": completed,
        "open_now": open_,
        "rolling_now": rolling,
        "cancelled_24h": cancelled,
        "total_pot_ton_24h": round(total_pot, 4),
        "total_rake_ton_24h": round(total_rake, 4),
        "current_rake_pct": current_rake,
        "by_mode_players": by_mode,
    }


@admin.get("/battles/config")
async def battles_config_get() -> dict:
    doc = await battles_control_col.find_one({"id": "control"}, {"_id": 0})
    return {
        "rake_pct": clamp_rake(float((doc or {}).get("rake_pct", HOUSE_RAKE_DEFAULT_PCT))),
        "rake_max_pct": HOUSE_RAKE_MAX_PCT,
    }


@admin.post("/battles/config")
async def battles_config_set(payload: RakeIn = Body(...)) -> dict:
    rake = clamp_rake(payload.rake_pct)
    await battles_control_col.update_one(
        {"id": "control"},
        {"$set": {"rake_pct": rake, "updated_at": iso(now())}},
        upsert=True,
    )
    return {"rake_pct": rake}


@admin.post("/battles/{battle_id}/force-cancel")
async def battles_force_cancel(
    battle_id: str = Path(..., min_length=4, max_length=64),
) -> dict:
    try:
        return await force_cancel(battle_id)
    except BattleError as e:
        raise HTTPException(404, str(e))
