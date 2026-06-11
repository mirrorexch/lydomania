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
        "candy_cane": 1.9, "lol_pop": 1.2, "lucky_coin": 2.0, "lucky_ticket": 1.5,
        "top_hat": 16.5, "flying_broom": 27.2, "trapped_heart": 4.6,
        "electric_skull": 24.6, "bonded_ring": 156.0,
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
    # Ensure the jackpot is unpriced (frozen) and corrupt its weight.
    await items_col.delete_one({"slug": jp["item_slug"]})
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
async def test_recalibration_preserves_total_item_weight():
    await _ensure_wheel_seeded()
    await _set_realistic_floors()
    before = [s async for s in segments_col.find({"segment_type": {"$ne": "ton_multi"}}, {"_id": 0})]
    total_before = sum(int(s.get("weight", 0)) for s in before)
    await recalibrate_wheel()
    after = [s async for s in segments_col.find({"segment_type": {"$ne": "ton_multi"}}, {"_id": 0})]
    total_after = sum(int(s.get("weight", 0)) for s in after)
    assert total_after == total_before, (total_before, total_after)
    # Every item slice keeps weight >= 1 (no unwinnable slices).
    assert all(int(s.get("weight", 0)) >= 1 for s in after)
