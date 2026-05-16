"""
Phase 3c — Case recalibration service.

Given live Fragment floors and per-case caps, recompute:
  • per-basket-item `payout_ton` (= live robust floor, so we can deliver)
  • per-basket-item `weight` (jackpot solved to hit target_ev_pct)

Solvency guardrails:
  • Items whose live floor > case.price_ton × MAX_PAYOUT_MULTIPLIER
    are REMOVED from the basket (e.g., a 6,100-TON Plush Pepe is never
    placed in a 10-TON Stickers Box).
  • Items still in the basket must have positive solved weights.
  • Realised EV must land in [target - 0.5%, target + 0.5%].

NEVER touches `inventory_items` rows — historical payouts are frozen by
design (Phase 3c data-integrity rule).
"""
from __future__ import annotations

from typing import Any, Optional

from core.db import cases_col, gift_floor_prices_col, items_col
from core.time_utils import iso, now


def _ev_for_basket(basket: list[dict[str, Any]]) -> float:
    total = sum(float(b.get("weight", 0)) for b in basket)
    if total <= 0:
        return 0.0
    return sum(float(b["payout_ton"]) * float(b["weight"]) / total for b in basket)


async def _load_live_floors() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    async for d in gift_floor_prices_col.find({"floor_ton": {"$ne": None}}, {"_id": 0}):
        out[d["slug"]] = d
    return out


def _resolve_payout_for_item(slug: str, floors: dict, fallback_floor: float) -> Optional[float]:
    """Prefer the live robust floor; fall back to absolute live floor; finally to the items-collection seed."""
    f = floors.get(slug)
    if f:
        robust = f.get("floor_ton_robust")
        if robust and robust > 0:
            return float(robust)
        abs_floor = f.get("floor_ton")
        if abs_floor and abs_floor > 0:
            return float(abs_floor)
    if fallback_floor and fallback_floor > 0:
        return float(fallback_floor)
    return None


def _solve_jackpot_weight(basket: list[dict[str, Any]], target_ev: float) -> Optional[float]:
    """Return jackpot weight that yields the target_ev (in TON), or None if infeasible."""
    if not basket:
        return None
    jp = max(basket, key=lambda b: float(b["payout_ton"]))
    others = [b for b in basket if b is not jp]
    W = sum(float(b["weight"]) for b in others)
    P_others_w = sum(float(b["weight"]) * float(b["payout_ton"]) for b in others)
    p_j = float(jp["payout_ton"])
    denom = target_ev - p_j
    if abs(denom) < 1e-9:
        return None
    w_j = (P_others_w - target_ev * W) / denom
    if w_j <= 0:
        return None
    return w_j


def _rebuild_inverse_payout_weights(basket: list[dict[str, Any]], *, base: float = 100.0) -> list[dict[str, Any]]:
    """Set non-jackpot weights ∝ 1/payout (cheap items more common, expensive rarer).

    Jackpot weight is left at 0 — caller solves it next.
    """
    if not basket:
        return basket
    jp = max(basket, key=lambda b: float(b["payout_ton"]))
    out: list[dict[str, Any]] = []
    for b in basket:
        if b is jp:
            out.append({"slug": b["slug"], "payout_ton": float(b["payout_ton"]), "weight": 0.0})
        else:
            p = max(1.0, float(b["payout_ton"]))
            out.append({"slug": b["slug"], "payout_ton": float(b["payout_ton"]), "weight": float(base / p)})
    return out


def _calibrate_basket(basket: list[dict[str, Any]], target_ev: float) -> tuple[Optional[list[dict[str, Any]]], Optional[float], str]:
    """Try to balance `basket` to hit target_ev.

    Strategy:
      A) Try preserving existing non-jackpot weights, solve jackpot weight only.
      B) Fallback: rebuild non-jackpot weights ∝ 1/payout (more natural curve when
         live floors shifted everything), then solve jackpot weight.
    Returns: (basket_with_solved_weights, jackpot_weight, mode)
    """
    if not basket:
        return None, None, "empty"
    # Strategy A — preserve curated weights
    w_j = _solve_jackpot_weight(basket, target_ev)
    if w_j is not None and w_j > 0:
        return basket, w_j, "preserved"
    # Strategy B — rebuild via inverse-payout
    rebuilt = _rebuild_inverse_payout_weights(basket)
    w_j = _solve_jackpot_weight(rebuilt, target_ev)
    if w_j is not None and w_j > 0:
        return rebuilt, w_j, "inverse_payout"
    return None, None, "infeasible"


async def recalibrate_case(
    case_id: str,
    *,
    max_payout_multiplier: float = 200.0,
    target_ev_pct: Optional[float] = None,
    min_basket_size: int = 4,
    apply: bool = True,
) -> dict[str, Any]:
    """Recalibrate one case using live floors. Returns a report dict."""
    case = await cases_col.find_one({"id": case_id}, {"_id": 0})
    if not case:
        return {"case_id": case_id, "ok": False, "error": "case not found"}
    price = float(case["price_ton"])
    target_pct = float(target_ev_pct if target_ev_pct is not None else case.get("target_ev_pct", 90.0))
    cap = price * float(max_payout_multiplier)
    floors = await _load_live_floors()
    items_seed: dict[str, dict] = {}
    async for d in items_col.find({}, {"_id": 0, "slug": 1, "name": 1, "floor_price_ton": 1}):
        items_seed[d["slug"]] = d

    new_basket: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    updated: list[dict[str, Any]] = []
    for entry in case.get("basket", []):
        slug = entry["slug"]
        old_payout = float(entry.get("payout_ton", 0))
        old_weight = float(entry.get("weight", 0))
        seed_floor = float(items_seed.get(slug, {}).get("floor_price_ton", 0))
        live_payout = _resolve_payout_for_item(slug, floors, seed_floor)
        if live_payout is None or live_payout <= 0:
            # Couldn't resolve a payout — keep the old payout but flag it.
            updated.append({
                "slug": slug, "old_payout": old_payout, "new_payout": old_payout,
                "old_weight": old_weight, "reason": "no live floor — preserved",
            })
            new_basket.append({"slug": slug, "weight": old_weight, "payout_ton": old_payout})
            continue
        if live_payout > cap:
            dropped.append({
                "slug": slug, "live_floor_ton": round(live_payout, 4),
                "case_cap_ton": round(cap, 2),
                "reason": f"floor {live_payout:.2f} > cap {cap:.2f} (price×{max_payout_multiplier:g})",
            })
            continue
        new_basket.append({"slug": slug, "weight": old_weight, "payout_ton": float(live_payout)})
        updated.append({
            "slug": slug,
            "old_payout": old_payout, "new_payout": round(float(live_payout), 4),
            "old_weight": old_weight,
        })

    if len(new_basket) < min_basket_size:
        return {
            "case_id": case_id, "ok": False,
            "error": f"basket size after caps ({len(new_basket)}) < min_basket_size ({min_basket_size})",
            "dropped": dropped, "kept_count": len(new_basket),
        }

    target_ev_ton = price * (target_pct / 100.0)
    solved_basket, w_j, mode = _calibrate_basket(new_basket, target_ev_ton)
    if solved_basket is None or w_j is None:
        return {
            "case_id": case_id, "ok": False,
            "error": "infeasible: cannot solve weights for target EV (basket payouts dominate target)",
            "dropped": dropped,
            "basket_preview": new_basket,
        }
    new_basket = solved_basket

    jp = max(new_basket, key=lambda b: float(b["payout_ton"]))
    jackpot_slug = jp["slug"]
    for b in new_basket:
        if b is jp:
            b["weight"] = round(float(w_j), 6)
    realised_ev = _ev_for_basket(new_basket)
    realised_pct = (realised_ev / price * 100.0) if price else 0.0
    drift_pct = realised_pct - target_pct

    report = {
        "case_id": case_id, "ok": True,
        "price_ton": price, "target_ev_pct": target_pct,
        "max_payout_cap_ton": round(cap, 2),
        "kept_count": len(new_basket), "dropped_count": len(dropped),
        "jackpot_slug": jackpot_slug,
        "jackpot_weight": round(float(w_j), 6),
        "realized_ev_pct": round(realised_pct, 3),
        "drift_pct": round(drift_pct, 3),
        "weight_mode": mode,
        "dropped": dropped, "updated": updated,
        "new_basket": new_basket,
    }
    if apply:
        await cases_col.update_one(
            {"id": case_id},
            {"$set": {"basket": new_basket, "recalibrated_at": iso(now()),
                      "recalibration_drift_pct": round(drift_pct, 3)}},
        )
        report["applied"] = True
    else:
        report["applied"] = False
    return report


async def sync_floors_to_items(*, apply: bool = True) -> dict[str, Any]:
    """Copy gift_floor_prices.floor_ton (absolute) onto items.floor_price_ton.

    Inventory rows are NOT touched (Phase 3c data integrity).
    """
    floors = await _load_live_floors()
    diffs: list[dict[str, Any]] = []
    updated = 0
    async for d in items_col.find({}, {"_id": 0, "slug": 1, "floor_price_ton": 1}):
        slug = d["slug"]
        f = floors.get(slug)
        if not f:
            continue
        new_val = f.get("floor_ton")
        if new_val is None or new_val <= 0:
            continue
        old_val = float(d.get("floor_price_ton") or 0)
        if abs(old_val - float(new_val)) < 1e-9:
            continue
        diffs.append({"slug": slug, "old": round(old_val, 4), "new": round(float(new_val), 4)})
        if apply:
            await items_col.update_one(
                {"slug": slug},
                {"$set": {"floor_price_ton": float(new_val), "floor_updated_at": iso(now())}},
            )
            updated += 1
    return {"items_updated": updated, "applied": apply, "diffs": diffs}


async def recalibrate_all_cases(
    *, max_payout_multiplier: float = 200.0, min_basket_size: int = 4, apply: bool = True,
) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    async for c in cases_col.find({"enabled": True}, {"_id": 0, "id": 1}):
        r = await recalibrate_case(
            c["id"],
            max_payout_multiplier=max_payout_multiplier,
            min_basket_size=min_basket_size,
            apply=apply,
        )
        reports.append(r)
    return {
        "applied": apply,
        "max_payout_multiplier": max_payout_multiplier,
        "cases_total": len(reports),
        "cases_ok": sum(1 for r in reports if r.get("ok")),
        "cases_failed": sum(1 for r in reports if not r.get("ok")),
        "reports": reports,
    }
