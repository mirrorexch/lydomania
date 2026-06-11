"""Wheel auto-recalibration tests — proves the wheel self-corrects to the
target RTP band even when gift floors drift far above design.
"""
from __future__ import annotations

import pytest

from core.db import db, items_col
from services.wheel_recalibration import recalibrate_wheel, TARGET_RTP

segments_col = db["wheel_segments"]


async def _ensure_wheel_seeded():
    if await segments_col.count_documents({}) == 0:
        from tools.seed_wheel_segments import main as seed_main
        await seed_main()


async def _set_realistic_floors():
    """Give the wheel a prod-like floor spread: cheap low-gifts (so there's room
    to absorb weight) + a few expensive ones. Returns the slug set used."""
    floors = {
        "candy_cane": 3.0, "lol_pop": 3.0, "lucky_coin": 2.0, "lucky_ticket": 1.5,
        "top_hat": 8.0, "flying_broom": 9.0, "trapped_heart": 4.6,
        "electric_skull": 25.0, "bonded_ring": 35.0,
        "durov_cap": 499.0,  # the real 500-TON grand jackpot
    }
    for slug, f in floors.items():
        await items_col.update_one({"slug": slug}, {"$set": {"floor_price_ton": f}}, upsert=True)


@pytest.mark.asyncio
async def test_recalibration_brings_drifted_wheel_into_band():
    await _ensure_wheel_seeded()
    await _set_realistic_floors()
    # Severe drift on the priciest gift — recalibration must still reach the band.
    await items_col.update_one(
        {"slug": "bonded_ring"}, {"$set": {"floor_price_ton": 500.0}}, upsert=True
    )

    res = await recalibrate_wheel()
    assert res["ok"], res
    # Back inside the 90-92% band despite the 500-TON floor.
    assert 0.90 <= res["rtp_after"] <= 0.92, res
    assert res["in_band"] is True, res


@pytest.mark.asyncio
async def test_recalibration_is_idempotent():
    await _ensure_wheel_seeded()
    await _set_realistic_floors()
    first = await recalibrate_wheel()
    second = await recalibrate_wheel()
    assert first["ok"] and second["ok"]
    # Re-running on unchanged floors lands at the same RTP (no oscillation).
    assert abs(first["rtp_after"] - second["rtp_after"]) < 0.005, (first, second)


@pytest.mark.asyncio
async def test_recalibration_heals_corrupted_frozen_jackpot_weight():
    """A frozen (unpriced) jackpot whose weight got corrupted must be reset to
    its canonical design weight — a missing price can't keep a grand prize frequent."""
    await _ensure_wheel_seeded()
    await _set_realistic_floors()
    jp = await segments_col.find_one({"segment_type": "jackpot"}, {"_id": 0})
    assert jp, "wheel must have a jackpot segment"
    # Jackpot is frozen by type (a real 500-TON prize). Corrupt its weight and
    # confirm recalibration heals it back to the rare design weight.
    await segments_col.update_one(
        {"segment_index": jp["segment_index"]}, {"$set": {"weight": 11}}
    )
    res = await recalibrate_wheel()
    assert res["ok"], res
    healed = await segments_col.find_one(
        {"segment_index": jp["segment_index"]}, {"_id": 0, "weight": 1}
    )
    assert healed["weight"] == 1, f"jackpot weight not healed to design: {healed}"


@pytest.mark.asyncio
async def test_recalibration_keeps_jackpot_rare_and_all_winnable():
    await _ensure_wheel_seeded()
    await _set_realistic_floors()
    res = await recalibrate_wheel()
    assert res["ok"], res
    after = [s async for s in segments_col.find({"segment_type": {"$ne": "ton_multi"}}, {"_id": 0})]
    # Every item slice keeps weight >= 1 (no unwinnable slices).
    assert all(int(s.get("weight", 0)) >= 1 for s in after)
    # The 500-TON jackpot stays at the rare design weight (1) — diluting is done
    # by scaling the OTHER items up, never by making the grand prize common.
    jp = await segments_col.find_one({"segment_type": "jackpot"}, {"_id": 0, "weight": 1})
    assert jp["weight"] == 1, jp
