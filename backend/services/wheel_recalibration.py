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
from core.wheel_engine import PAID_SPIN_COST_TON, SEGMENT_DEFS, rtp as wheel_rtp

segments_col = db["wheel_segments"]

# Canonical design weight per segment_index — the recalibration baselines on these
# (not on the live DB weights) so a frozen/unpriced segment always returns to its
# intended rarity even if a prior run left a bad value in the DB (self-healing).
_DESIGN_WEIGHT: dict[int, int] = {
    int(d["segment_index"]): int(d["weight"]) for d in SEGMENT_DEFS
}

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


_BAND_LO: float = 0.90
_BAND_HI: float = 0.92


def _tunable_weights_for_scale(
    tunable: list[dict[str, Any]], floors: dict[str, float], total: int
) -> list[int]:
    """Distribute `total` weight across TUNABLE item segments ∝ 1/floor (cheap
    items common, expensive rare), each w≥1.

    Total item weight is a FREE variable (not a fixed budget): scaling it up
    dilutes a high-value frozen jackpot, which is how a 500-TON grand prize can
    sit on a 5-TON wheel at the target RTP. RTP is monotonically decreasing in
    `total`, so the caller binary-searches it.
    """
    n = len(tunable)
    if n == 0:
        return []
    raw = [1.0 / max(0.01, floors.get(s.get("item_slug") or "", 0.0)) for s in tunable]
    s = sum(raw) or 1.0
    remainder = max(0, total - n * _MIN_WEIGHT)
    weights = [_MIN_WEIGHT + int(round(remainder * (r / s))) for r in raw]
    drift = total - sum(weights)
    if drift != 0:
        idx = max(range(n), key=lambda i: raw[i])  # cheapest item absorbs drift
        weights[idx] = max(_MIN_WEIGHT, weights[idx] + drift)
    return weights


def _rtp_for(
    ton_segs: list[dict[str, Any]],
    frozen: list[dict[str, Any]],
    tunable: list[dict[str, Any]],
    tunable_weights: list[int],
    floors: dict[str, float],
) -> float:
    rebuilt: list[dict[str, Any]] = list(ton_segs) + list(frozen)
    for seg, w in zip(tunable, tunable_weights):
        rebuilt.append({**seg, "weight": int(w)})
    return wheel_rtp(rebuilt, cost_ton=PAID_SPIN_COST_TON, item_floor_lookup=floors)


def _greedy_into_band(
    ton_segs, frozen, tunable, weights, floors, target_rtp
) -> list[int]:
    """Integer-precise landing: move 1 weight unit between the cheapest and
    most-expensive tunable segment until RTP is inside [_BAND_LO, _BAND_HI]."""
    w = list(weights)
    floor_of = lambda i: floors.get(tunable[i].get("item_slug") or "", 0.0)
    order = sorted(range(len(tunable)), key=floor_of)  # cheap → expensive
    cheapest, dearest = order[0], order[-1]
    for _ in range(2000):
        r = _rtp_for(ton_segs, frozen, tunable, w, floors)
        if _BAND_LO <= r <= _BAND_HI:
            break
        if r > _BAND_HI:               # too generous → make dear rarer, cheap commoner
            if w[dearest] <= _MIN_WEIGHT:
                break
            w[dearest] -= 1
            w[cheapest] += 1
        else:                          # too stingy → make dear commoner
            if w[cheapest] <= _MIN_WEIGHT:
                break
            w[cheapest] -= 1
            w[dearest] += 1
    return w


async def recalibrate_wheel(target_rtp: float = TARGET_RTP) -> dict[str, Any]:
    """Re-solve TUNABLE item-segment weights so the wheel RTP lands in band.

    Segments whose item has no known positive floor (e.g. the jackpot phantom or
    an unpriced gift) are FROZEN at their current weight — never inflated — so a
    missing price can't turn a rare grand prize into a frequent one. Fail-safe:
    if the band can't be reached, nothing is persisted and a warning is logged.
    """
    segs = [s async for s in segments_col.find({}, {"_id": 0}).sort("segment_index", 1)]
    if not segs:
        return {"ok": False, "reason": "no_wheel_segments"}

    ton_segs = [s for s in segs if s.get("segment_type") == "ton_multi"]
    item_segs = [s for s in segs if s.get("segment_type") != "ton_multi"]
    if not item_segs:
        return {"ok": False, "reason": "no_item_segments"}

    floors = await _load_floors({s.get("item_slug") for s in item_segs if s.get("item_slug")})

    rtp_before = wheel_rtp(segs, cost_ton=PAID_SPIN_COST_TON, item_floor_lookup=floors)

    # Partition: tunable = known positive floor; frozen = missing/zero floor.
    # Frozen segments are RESET to their canonical design weight (self-healing: a
    # prior bad run can't leave an unpriced jackpot stuck at an inflated weight).
    def _design_w(seg: dict[str, Any]) -> int:
        return _DESIGN_WEIGHT.get(int(seg["segment_index"]), int(seg.get("weight", 1)))

    # Frozen = the jackpot (always rare, by type) + any unpriced segment. Frozen
    # segments keep their design weight; their (possibly large) value is counted
    # but their rarity is fixed so a grand prize can't become frequent.
    def _is_frozen(seg: dict[str, Any]) -> bool:
        return seg.get("segment_type") == "jackpot" or floors.get(seg.get("item_slug") or "", 0.0) <= 0

    tunable = [s for s in item_segs if not _is_frozen(s)]
    frozen = [{**s, "weight": _design_w(s)} for s in item_segs if _is_frozen(s)]
    if not tunable:
        return {"ok": False, "reason": "no_tunable_item_segments"}

    # Binary-search the TOTAL tunable item weight. Scaling it up dilutes the frozen
    # jackpot (and ton_multi), monotonically lowering RTP — so we can place a
    # 500-TON grand prize on a 5-TON wheel and still hit the band.
    n = len(tunable)

    def rtp_at(total: int) -> float:
        return _rtp_for(ton_segs, frozen, tunable, _tunable_weights_for_scale(tunable, floors, total), floors)

    lo, hi = n, n  # grow hi until RTP drops below target
    hi = max(n + 1, 64)
    for _ in range(40):
        if rtp_at(hi) < target_rtp:
            break
        hi *= 2
    if rtp_at(n) < target_rtp:
        total = n  # even minimal tunable weight already under target → use minimum
    else:
        lo = n
        for _ in range(60):
            mid = (lo + hi) // 2
            if mid <= lo:
                break
            if rtp_at(mid) > target_rtp:
                lo = mid
            else:
                hi = mid
        total = hi

    weights = _tunable_weights_for_scale(tunable, floors, total)
    weights = _greedy_into_band(ton_segs, frozen, tunable, weights, floors, target_rtp)
    rtp_after = _rtp_for(ton_segs, frozen, tunable, weights, floors)

    in_band = _BAND_LO <= rtp_after <= _BAND_HI
    if not in_band:
        # Fail-safe: refuse to persist an out-of-band config — keep current weights.
        logger.warning(
            "[wheel_recalibration] could NOT reach band: rtp_before=%.2f%% best=%.2f%% — NOT persisting",
            rtp_before * 100, rtp_after * 100,
        )
        return {"ok": False, "reason": "unreachable_band",
                "rtp_before": round(rtp_before, 4), "rtp_best": round(rtp_after, 4)}

    changes: list[dict[str, Any]] = []
    # Heal any frozen segment whose live DB weight drifted from its design weight.
    cur_by_idx = {int(s["segment_index"]): int(s.get("weight", 0)) for s in item_segs}
    for seg in frozen:
        idx = int(seg["segment_index"])
        if cur_by_idx.get(idx) != int(seg["weight"]):
            await segments_col.update_one(
                {"segment_index": idx},
                {"$set": {"weight": int(seg["weight"]), "recalibrated_at": iso(now())}},
            )
            changes.append({
                "segment_index": idx, "item_slug": seg.get("item_slug"),
                "floor": 0.0, "old_weight": cur_by_idx.get(idx, 0),
                "new_weight": int(seg["weight"]), "frozen": True,
            })
    for seg, w in zip(tunable, weights):
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
        "[wheel_recalibration] RTP %.2f%% -> %.2f%% (target %.0f%%, lambda=%.4f, frozen=%d)",
        rtp_before * 100, rtp_after * 100, target_rtp * 100, lam, len(frozen),
    )
    return {
        "ok": True,
        "rtp_before": round(rtp_before, 4),
        "rtp_after": round(rtp_after, 4),
        "target": target_rtp,
        "lambda": lam,
        "frozen_segments": [s.get("item_slug") for s in frozen],
        "in_band": in_band,
        "changes": changes,
    }
