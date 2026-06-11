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


@pytest.mark.asyncio
async def test_recalibration_brings_drifted_wheel_into_band():
    await _ensure_wheel_seeded()

    # Simulate severe floor drift: blow up a high-gift floor far above design.
    high_seg = await segments_col.find_one({"segment_type": "high_gift"}, {"_id": 0})
    assert high_seg and high_seg.get("item_slug"), "wheel must have a high_gift segment"
    slug = high_seg["item_slug"]
    await items_col.update_one(
        {"slug": slug}, {"$set": {"floor_price_ton": 500.0}}, upsert=True
    )

    res = await recalibrate_wheel()
    assert res["ok"], res
    # After recalibration the wheel must be back in the 90-92% band despite the
    # 500-TON floor — expensive gifts get re-weighted rarer.
    assert 0.90 <= res["rtp_after"] <= 0.92, res
    assert res["in_band"] is True, res


@pytest.mark.asyncio
async def test_recalibration_is_idempotent():
    await _ensure_wheel_seeded()
    first = await recalibrate_wheel()
    second = await recalibrate_wheel()
    assert first["ok"] and second["ok"]
    # Re-running on unchanged floors lands at the same RTP (no oscillation).
    assert abs(first["rtp_after"] - second["rtp_after"]) < 0.005, (first, second)


@pytest.mark.asyncio
async def test_recalibration_preserves_total_item_weight():
    await _ensure_wheel_seeded()
    before = [s async for s in segments_col.find({"segment_type": {"$ne": "ton_multi"}}, {"_id": 0})]
    total_before = sum(int(s.get("weight", 0)) for s in before)
    await recalibrate_wheel()
    after = [s async for s in segments_col.find({"segment_type": {"$ne": "ton_multi"}}, {"_id": 0})]
    total_after = sum(int(s.get("weight", 0)) for s in after)
    assert total_after == total_before, (total_before, total_after)
    # Every item slice keeps weight >= 1 (no unwinnable slices).
    assert all(int(s.get("weight", 0)) >= 1 for s in after)
