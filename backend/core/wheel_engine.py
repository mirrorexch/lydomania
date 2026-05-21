"""Phase 7b — Wheel of Fortune engine.

Pure functions only:
  • derive_segment(server_seed, spin_id, segments) → int (0..N-1)
  • payout_for_segment(segment, cost_ton) → dict
  • validate weights, etc.

Provably-fair: HMAC_SHA256(server_seed, spin_id).digest() → 256-bit int.
We take `int(h, 16) % total_weight` and walk the cumulative weights to find
the winning segment.  This is the same algorithm used by every weighted-pick
roulette on the planet, so it's well-studied and easy to verify.

Segment-types & values are locked here. The full 24-segment definition lives
in `SEGMENT_DEFS` below. Tools/seed_wheel_segments.py mirrors this list into
Mongo.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Final

PAID_SPIN_COST_TON: Final[float] = 5.0
SEGMENT_COUNT: Final[int] = 24
FREE_TOKEN_REFRESH_SEC: Final[int] = 24 * 60 * 60

# Order matters: wheel_index 0 is "top" (under the pointer at 12 o'clock).
# Visually rotating clockwise, segments are laid out 0..23 in 15°-wide slices.
#
# Phase 11.3 reconfiguration ─────────────────────────────────────────────────
#   • Layout: alternating ton_multi / item — 12 ton_multi + 12 item = 50/50
#   • Item pool (12): 6 LOW + 3 MID + 2 HI + 1 JACKPOT
#   • Removed from wheel: token_dust (0.1 T) and coin_flip (0.3 T) — they
#     felt like a slap in the face on a 5 T paid spin. They still exist in
#     items collection for Battle Pass tier rewards (see season_engine.py),
#     just not in the wheel anymore.
#   • Renamed: daily_jackpot → lucky_coin (the name "Daily Jackpot" with a
#     2 T floor was actively misleading users into thinking they'd hit
#     a jackpot when they got a low-tier consolation item).
#   • lucky_ticket floor bumped 0.75 → 1.5 T in items collection — anything
#     below 1 T on a 5 T spin reads as "rigged" even when math is fair.
#   • Total weight = 192 (96 item / 96 ton_multi exactly = 50/50 by prob).
#   • ton_multi mix: 5×0.5 + 3×0.75 + 3×1.0 + 1×1.25 → avg = 0.75 ⇒
#     ton_multi EV per spin = 1.875 T
#   • Item EV per spin = 2.745 T   (LOW 0.760 + MID 0.8125 + HI 0.625 + JACK 0.547)
#   • Total EV = 4.62 T  ⇒  RTP = 4.62 / 5.0 = 92.4 %   (target 92 % ✓)
SEGMENT_DEFS: Final[list[dict[str, Any]]] = [
    # 0..23 — interleave multis and gifts so the wheel looks visually balanced.
    {"segment_index":  0, "segment_type": "ton_multi", "multiplier": 0.50, "item_slug": None, "weight": 8},
    {"segment_index":  1, "segment_type": "low_gift",  "multiplier": None, "item_slug": "candy_cane",     "weight": 13},
    {"segment_index":  2, "segment_type": "ton_multi", "multiplier": 0.75, "item_slug": None, "weight": 8},
    {"segment_index":  3, "segment_type": "low_gift",  "multiplier": None, "item_slug": "candy_cane",     "weight": 12},
    {"segment_index":  4, "segment_type": "ton_multi", "multiplier": 1.00, "item_slug": None, "weight": 8},
    {"segment_index":  5, "segment_type": "mid_gift",  "multiplier": None, "item_slug": "top_hat",        "weight": 6},
    {"segment_index":  6, "segment_type": "ton_multi", "multiplier": 0.50, "item_slug": None, "weight": 8},
    {"segment_index":  7, "segment_type": "low_gift",  "multiplier": None, "item_slug": "lol_pop",        "weight": 12},
    {"segment_index":  8, "segment_type": "ton_multi", "multiplier": 0.75, "item_slug": None, "weight": 8},
    {"segment_index":  9, "segment_type": "low_gift",  "multiplier": None, "item_slug": "lucky_coin",     "weight": 12},
    {"segment_index": 10, "segment_type": "ton_multi", "multiplier": 1.25, "item_slug": None, "weight": 8},
    {"segment_index": 11, "segment_type": "mid_gift",  "multiplier": None, "item_slug": "flying_broom",   "weight": 6},
    {"segment_index": 12, "segment_type": "ton_multi", "multiplier": 0.50, "item_slug": None, "weight": 8},
    {"segment_index": 13, "segment_type": "low_gift",  "multiplier": None, "item_slug": "lucky_ticket",   "weight": 12},
    {"segment_index": 14, "segment_type": "ton_multi", "multiplier": 0.75, "item_slug": None, "weight": 8},
    {"segment_index": 15, "segment_type": "low_gift",  "multiplier": None, "item_slug": "lucky_ticket",   "weight": 12},
    {"segment_index": 16, "segment_type": "ton_multi", "multiplier": 0.50, "item_slug": None, "weight": 8},
    {"segment_index": 17, "segment_type": "high_gift", "multiplier": None, "item_slug": "electric_skull", "weight": 2},
    {"segment_index": 18, "segment_type": "ton_multi", "multiplier": 1.00, "item_slug": None, "weight": 8},
    {"segment_index": 19, "segment_type": "mid_gift",  "multiplier": None, "item_slug": "trapped_heart",  "weight": 6},
    {"segment_index": 20, "segment_type": "ton_multi", "multiplier": 0.50, "item_slug": None, "weight": 8},
    {"segment_index": 21, "segment_type": "high_gift", "multiplier": None, "item_slug": "bonded_ring",    "weight": 2},
    {"segment_index": 22, "segment_type": "ton_multi", "multiplier": 1.00, "item_slug": None, "weight": 8},
    {"segment_index": 23, "segment_type": "jackpot",   "multiplier": None, "item_slug": "heart_of_ton",   "weight": 1},
]
assert len(SEGMENT_DEFS) == SEGMENT_COUNT


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def total_weight(segments: list[dict[str, Any]]) -> int:
    return sum(int(s["weight"]) for s in segments)


def derive_segment(
    server_seed: str, spin_id: str, segments: list[dict[str, Any]] | None = None,
) -> int:
    """Returns the winning `segment_index`. Uses HMAC-SHA256 walk over cumulative
    weights — fully deterministic from (server_seed, spin_id, segment table)."""
    segs = segments if segments is not None else SEGMENT_DEFS
    h = hmac.new(server_seed.encode(), spin_id.encode(), hashlib.sha256).hexdigest()
    pick = int(h, 16) % total_weight(segs)
    cum = 0
    for s in segs:
        cum += int(s["weight"])
        if pick < cum:
            return int(s["segment_index"])
    return int(segs[-1]["segment_index"])      # unreachable in practice


def payout_for_segment(
    segment: dict[str, Any],
    cost_ton: float = PAID_SPIN_COST_TON,
    item_floor_lookup: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Compute the payout for a given segment.

    Returns:
      • payout_type: "ton" | "item"
      • payout_ton:  float (0 for items)
      • payout_item_slug: str | None
      • estimated_value_ton: float  — used for EV/RTP sims (= floor for items)
    """
    floors = item_floor_lookup or {}
    if segment["segment_type"] == "ton_multi":
        mult = float(segment["multiplier"])
        amount = round(cost_ton * mult, 4)
        return {
            "payout_type": "ton",
            "payout_ton": amount,
            "payout_item_slug": None,
            "estimated_value_ton": amount,
        }
    slug = segment["item_slug"]
    floor = float(floors.get(slug, 0.0))
    return {
        "payout_type": "item",
        "payout_ton": 0.0,
        "payout_item_slug": slug,
        "estimated_value_ton": floor,
    }


def expected_value(
    segments: list[dict[str, Any]],
    cost_ton: float = PAID_SPIN_COST_TON,
    item_floor_lookup: dict[str, float] | None = None,
) -> float:
    """Closed-form EV per spin given the segment table + floor prices."""
    tw = total_weight(segments)
    ev = 0.0
    for s in segments:
        p = int(s["weight"]) / tw
        v = payout_for_segment(s, cost_ton, item_floor_lookup)["estimated_value_ton"]
        ev += p * v
    return ev


def rtp(
    segments: list[dict[str, Any]],
    cost_ton: float = PAID_SPIN_COST_TON,
    item_floor_lookup: dict[str, float] | None = None,
) -> float:
    if cost_ton <= 0:
        return 0.0
    return expected_value(segments, cost_ton, item_floor_lookup) / cost_ton
