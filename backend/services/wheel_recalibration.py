"""Wheel auto-recalibration — hold the Wheel of Fortune at a target RTP despite
live gift-floor drift.

The wheel pays TON multipliers (fixed) + gift items (value = live floor price).
When floors drift up, item EV balloons and RTP can exceed 100% (the house then
loses money). Roulette already self-corrects via its floor-watcher; the wheel
did not. This service is the wheel's equivalent.

Algorithm (deterministic, provably-fair-preserving — only segment *weights*
change, never the commit-reveal derivation):

  • ton_multi segments keep their weights (their EV is fixed by multiplier).
  • Each item segment is re-weighted by  w_i ∝ exp(-λ · floor_i)  so that more
    expensive gifts become rarer. λ is binary-searched so the whole wheel's
    closed-form RTP lands on TARGET_RTP. λ=0 → uniform (max EV); larger λ →
    weight collapses onto the cheapest gifts (min EV). RTP is monotonic in λ,
    so the search always converges.
  • Total item weight is preserved (visual 50/50 item/ton_multi split intact);
    every segment keeps weight ≥ 1 so no slice becomes unwinnable.

Idempotent: re-running with the same floors yields the same weights.
"""
from __future__ import annotations

import math
from typing import Any

from core.config import logger
from core.db import db, items_col
from core.time_utils import iso, now
from core.wheel_engine import PAID_SPIN_COST_TON, rtp as wheel_rtp

segments_col = db["wheel_segments"]

TARGET_RTP: float = 0.91
_TOLERANCE: float = 0.004  # land within ±0.4pp of target
_MIN_WEIGHT: int = 1


async def _load_floors(slugs: set[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not slugs:
        return out
    async for it in items_col.find(
        {"slug": {"$in": list(slugs)}}, {"_id": 0, "slug": 1, "floor_price_ton": 1}
    ):
        out[it["slug"]] = float(it.get("floor_price_ton") or 0.0)
    return out


def _item_weights_for_lambda(
    item_segs: list[dict[str, Any]], floors: dict[str, float], lam: float, total_item_weight: int
) -> list[int]:
    """Distribute `total_item_weight` across item segments ∝ exp(-λ·floor), w≥1."""
    raw = [math.exp(-lam * floors.get(s.get("item_slug") or "", 0.0)) for s in item_segs]
    s = sum(raw) or 1.0
    # Reserve the minimum first, distribute the remainder by the exp weights.
    n = len(item_segs)
    remainder = max(0, total_item_weight - n * _MIN_WEIGHT)
    weights = [_MIN_WEIGHT + int(round(remainder * (r / s))) for r in raw]
    # Fix rounding drift so the sum is exactly total_item_weight.
    drift = total_item_weight - sum(weights)
    if drift != 0:
        # Apply drift to the segment with the largest exp weight (cheapest item).
        idx = max(range(n), key=lambda i: raw[i])
        weights[idx] = max(_MIN_WEIGHT, weights[idx] + drift)
    return weights


def _rtp_for_weights(
    ton_segs: list[dict[str, Any]],
    item_segs: list[dict[str, Any]],
    item_weights: list[int],
    floors: dict[str, float],
) -> float:
    rebuilt: list[dict[str, Any]] = list(ton_segs)
    for seg, w in zip(item_segs, item_weights):
        rebuilt.append({**seg, "weight": int(w)})
    return wheel_rtp(rebuilt, cost_ton=PAID_SPIN_COST_TON, item_floor_lookup=floors)


async def recalibrate_wheel(target_rtp: float = TARGET_RTP) -> dict[str, Any]:
    """Re-solve item-segment weights so the wheel's RTP ≈ target. Persists to DB."""
    segs = [s async for s in segments_col.find({}, {"_id": 0}).sort("segment_index", 1)]
    if not segs:
        return {"ok": False, "reason": "no_wheel_segments"}

    ton_segs = [s for s in segs if s.get("segment_type") == "ton_multi"]
    item_segs = [s for s in segs if s.get("segment_type") != "ton_multi"]
    if not item_segs:
        return {"ok": False, "reason": "no_item_segments"}

    slugs = {s.get("item_slug") for s in item_segs if s.get("item_slug")}
    floors = await _load_floors(slugs)
    total_item_weight = sum(int(s.get("weight", 0)) for s in item_segs)

    rtp_before = wheel_rtp(segs, cost_ton=PAID_SPIN_COST_TON, item_floor_lookup=floors)

    def rtp_at(lam: float) -> float:
        w = _item_weights_for_lambda(item_segs, floors, lam, total_item_weight)
        return _rtp_for_weights(ton_segs, item_segs, w, floors)

    # λ=0 gives the maximum achievable RTP (uniform item weights). If even that is
    # below target, we can't raise it by re-weighting alone — keep uniform.
    hi_rtp = rtp_at(0.0)
    if hi_rtp <= target_rtp + _TOLERANCE:
        lam = 0.0
    else:
        lo, hi = 0.0, 5.0
        # Ensure hi drives RTP below target; expand if needed.
        for _ in range(40):
            if rtp_at(hi) < target_rtp:
                break
            hi *= 2.0
        lam = hi
        for _ in range(60):  # binary search — RTP is monotonically decreasing in λ
            mid = (lo + hi) / 2.0
            if rtp_at(mid) > target_rtp:
                lo = mid
            else:
                hi = mid
            lam = mid
            if abs(rtp_at(mid) - target_rtp) <= _TOLERANCE:
                break

    new_weights = _item_weights_for_lambda(item_segs, floors, lam, total_item_weight)
    rtp_after = _rtp_for_weights(ton_segs, item_segs, new_weights, floors)

    # Persist new weights per item segment (only the weight field changes).
    changes: list[dict[str, Any]] = []
    for seg, w in zip(item_segs, new_weights):
        if int(seg.get("weight", 0)) != int(w):
            await segments_col.update_one(
                {"segment_index": seg["segment_index"]},
                {"$set": {"weight": int(w), "recalibrated_at": iso(now())}},
            )
        changes.append({
            "segment_index": seg["segment_index"],
            "item_slug": seg.get("item_slug"),
            "floor": floors.get(seg.get("item_slug") or "", 0.0),
            "old_weight": int(seg.get("weight", 0)),
            "new_weight": int(w),
        })

    logger.info(
        "[wheel_recalibration] RTP %.2f%% -> %.2f%% (target %.0f%%, lambda=%.4f)",
        rtp_before * 100, rtp_after * 100, target_rtp * 100, lam,
    )
    return {
        "ok": True,
        "rtp_before": round(rtp_before, 4),
        "rtp_after": round(rtp_after, 4),
        "target": target_rtp,
        "lambda": lam,
        "in_band": 0.90 <= rtp_after <= 0.92,
        "changes": changes,
    }
