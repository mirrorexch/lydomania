"""Admin cases CRUD (Phase 3a). Cases are soft-deletable via enabled=false."""
from __future__ import annotations

import secrets
from typing import Any, Optional

from fastapi import HTTPException, Query

from core.db import cases_col, inventory_col, items_col, rolls_col
from core.models import (
    AdminCaseIn, AdminCasePatchIn, AdminCaseStatsOut, CalibrateIn, CalibrateOut,
    CaseDetailOut,
)
from core.time_utils import iso, now
from core.ton import static_url
from datetime import datetime, timedelta, timezone
from routers.admin import admin
from routers.cases import _build_basket_entries, _case_to_summary, _load_items_by_slug


def _slugify(name: str) -> str:
    s = "".join(c.lower() if c.isalnum() else "_" for c in name).strip("_")
    while "__" in s:
        s = s.replace("__", "_")
    return s or "case"


def _ev_for_basket(basket: list[dict[str, Any]]) -> float:
    total = sum(float(b.get("weight", 0)) for b in basket)
    if total <= 0:
        return 0.0
    return sum(float(b["payout_ton"]) * float(b["weight"]) / total for b in basket)


@admin.get("/cases")
async def admin_list_cases(include_disabled: bool = Query(True)):
    q = {} if include_disabled else {"enabled": True}
    out = []
    async for c in cases_col.find(q, {"_id": 0}).sort("price_ton", 1):
        s = await _case_to_summary(c)
        out.append(s.model_dump())
    return out


# IMPORTANT: must come BEFORE /cases/{case_id} so 'heatmap' isn't matched as case_id.
@admin.get("/cases/heatmap")
async def admin_cases_heatmap(window_days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    """Phase 4a — Drift heatmap data for all enabled cases.

    Returns per case: target_ev_pct, theoretical_ev_pct (from current basket math),
    realized_rtp_pct (last `window_days` of opens), opens_total in window, plus a
    `window_days`-length list of daily open counts for the sparkline.
    """
    now_dt = datetime.now(tz=timezone.utc)
    since_dt = now_dt - timedelta(days=window_days)
    since_iso_str = iso(since_dt)
    day_buckets: list[str] = []
    d = since_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    while d.date() <= now_dt.date():
        day_buckets.append(d.date().isoformat())
        d = d + timedelta(days=1)

    rows: list[dict[str, Any]] = []
    async for c in cases_col.find({"enabled": True}, {"_id": 0}).sort("price_ton", 1):
        case_id = c["id"]
        price = float(c.get("price_ton") or 0)
        target = float(c.get("target_ev_pct", 90.0))
        basket = c.get("basket", []) or []
        tw = sum(float(b.get("weight", 0)) for b in basket)
        theoretical_ev = (
            sum(float(b["payout_ton"]) * float(b["weight"]) / tw for b in basket) if tw else 0.0
        )
        theoretical_pct = (theoretical_ev / price * 100.0) if price else 0.0
        pipe = [
            {"$match": {"case_id": case_id, "created_at": {"$gte": since_iso_str}}},
            {"$group": {"_id": None, "n": {"$sum": 1}, "won": {"$sum": "$payout_ton"}}},
        ]
        doc = await rolls_col.aggregate(pipe).to_list(1)
        n = int(doc[0]["n"]) if doc else 0
        won = float(doc[0]["won"]) if doc else 0.0
        paid = n * price
        realized_pct = (won / paid * 100.0) if paid else 0.0
        opens_per_day = [0] * len(day_buckets)
        pipe2 = [
            {"$match": {"case_id": case_id, "created_at": {"$gte": since_iso_str}}},
            {"$project": {"day": {"$substr": ["$created_at", 0, 10]}}},
            {"$group": {"_id": "$day", "n": {"$sum": 1}}},
        ]
        async for r in rolls_col.aggregate(pipe2):
            try:
                idx = day_buckets.index(r["_id"])
                opens_per_day[idx] = int(r["n"])
            except ValueError:
                pass
        rows.append({
            "case_id": case_id, "name": c["name"], "price_ton": price,
            "target_ev_pct": target,
            "theoretical_ev_pct": round(theoretical_pct, 3),
            "theoretical_drift_pct": round(theoretical_pct - target, 3),
            "realized_rtp_pct": round(realized_pct, 3),
            "realized_drift_pct": round(realized_pct - target, 3) if n > 0 else 0.0,
            "opens_total": n,
            "opens_per_day": opens_per_day,
        })
    return {
        "window_days": window_days,
        "generated_at": iso(now_dt),
        "rows": rows,
    }


@admin.get("/cases/{case_id}", response_model=CaseDetailOut)
async def admin_get_case(case_id: str) -> CaseDetailOut:
    c = await cases_col.find_one({"id": case_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="case not found")
    items_meta = await _load_items_by_slug([b["slug"] for b in c.get("basket", [])])
    entries = _build_basket_entries(c, items_meta)
    summary = await _case_to_summary(c)
    return CaseDetailOut(**summary.model_dump(), items=entries, basket=entries)


@admin.post("/cases", response_model=CaseDetailOut)
async def admin_create_case(payload: AdminCaseIn) -> CaseDetailOut:
    # Validate basket slugs exist
    basket_in = [{"slug": b.slug, "weight": float(b.weight), "payout_ton": float(b.payout_ton)} for b in payload.basket]
    if basket_in:
        existing = {i["slug"] async for i in items_col.find(
            {"slug": {"$in": [b["slug"] for b in basket_in]}}, {"_id": 0, "slug": 1}
        )}
        missing = [b["slug"] for b in basket_in if b["slug"] not in existing]
        if missing:
            raise HTTPException(status_code=400, detail=f"unknown item slugs: {missing}")
    cid = payload.id or _slugify(payload.name)
    if await cases_col.find_one({"id": cid}, {"_id": 0}):
        raise HTTPException(status_code=409, detail=f"case '{cid}' already exists")
    doc = {
        "id": cid, "name": payload.name, "slug": payload.slug or cid,
        "price_ton": float(payload.price_ton),
        "image_path": payload.image_path or payload.image_url or f"cases/{cid}.png",
        "target_ev_pct": float(payload.target_ev_pct),
        "enabled": bool(payload.enabled),
        "basket": basket_in,
        "created_at": iso(now()),
    }
    await cases_col.insert_one(doc)
    return await admin_get_case(cid)


@admin.patch("/cases/{case_id}", response_model=CaseDetailOut)
async def admin_patch_case(case_id: str, patch: AdminCasePatchIn) -> CaseDetailOut:
    existing = await cases_col.find_one({"id": case_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="case not found")
    upd: dict[str, Any] = {"updated_at": iso(now())}
    for k in ("name", "price_ton", "image_path", "target_ev_pct", "enabled"):
        v = getattr(patch, k, None)
        if v is not None:
            upd[k] = v if not isinstance(v, float) else float(v)
    if patch.basket is not None:
        basket_in = [{"slug": b.slug, "weight": float(b.weight), "payout_ton": float(b.payout_ton)} for b in patch.basket]
        if basket_in:
            existing_slugs = {i["slug"] async for i in items_col.find(
                {"slug": {"$in": [b["slug"] for b in basket_in]}}, {"_id": 0, "slug": 1}
            )}
            missing = [b["slug"] for b in basket_in if b["slug"] not in existing_slugs]
            if missing:
                raise HTTPException(status_code=400, detail=f"unknown item slugs: {missing}")
        upd["basket"] = basket_in
    await cases_col.update_one({"id": case_id}, {"$set": upd})
    return await admin_get_case(case_id)


@admin.delete("/cases/{case_id}")
async def admin_disable_case(case_id: str) -> dict[str, Any]:
    res = await cases_col.update_one({"id": case_id}, {"$set": {"enabled": False, "disabled_at": iso(now())}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="case not found")
    return {"ok": True, "id": case_id, "enabled": False}


@admin.post("/cases/{case_id}/calibrate", response_model=CalibrateOut)
async def admin_calibrate_case(case_id: str, payload: CalibrateIn) -> CalibrateOut:
    """Compute jackpot weight that yields target_ev_pct exactly."""
    c = await cases_col.find_one({"id": case_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="case not found")
    basket = c.get("basket", [])
    if not basket:
        return CalibrateOut(current_ev_pct=0.0, feasible=False, message="empty basket")
    price = float(c["price_ton"])
    target_ev = price * (payload.target_ev_pct / 100.0)
    current_ev = _ev_for_basket(basket)
    current_ev_pct = (current_ev / price) * 100.0 if price else 0.0
    # Identify jackpot = highest payout
    jp = max(basket, key=lambda b: float(b["payout_ton"]))
    others = [b for b in basket if b is not jp]
    W = sum(float(b["weight"]) for b in others)
    P_others_w = sum(float(b["weight"]) * float(b["payout_ton"]) for b in others)
    p_j = float(jp["payout_ton"])
    denom = target_ev - p_j
    if abs(denom) < 1e-9:
        return CalibrateOut(
            current_ev_pct=round(current_ev_pct, 2),
            feasible=False, jackpot_slug=jp["slug"],
            message="jackpot payout equals target EV — cannot solve",
        )
    w_j = (P_others_w - target_ev * W) / denom
    if w_j <= 0:
        return CalibrateOut(
            current_ev_pct=round(current_ev_pct, 2),
            feasible=False, jackpot_slug=jp["slug"],
            message=f"target EV {payload.target_ev_pct:.2f}% unreachable with this jackpot payout",
        )
    return CalibrateOut(
        current_ev_pct=round(current_ev_pct, 2),
        recommended_jackpot_weight=round(w_j, 6),
        jackpot_slug=jp["slug"], feasible=True,
        message=f"set {jp['slug']} weight to {w_j:.4f} to hit {payload.target_ev_pct:.2f}% RTP",
    )


@admin.get("/cases/{case_id}/stats", response_model=AdminCaseStatsOut)
async def admin_case_stats(case_id: str) -> AdminCaseStatsOut:
    c = await cases_col.find_one({"id": case_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="case not found")
    price = float(c["price_ton"])
    target = float(c.get("target_ev_pct", 0))
    pipe = [
        {"$match": {"case_id": case_id}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "won": {"$sum": "$payout_ton"}}},
    ]
    doc = await rolls_col.aggregate(pipe).to_list(1)
    n = int(doc[0]["n"]) if doc else 0
    won = float(doc[0]["won"]) if doc else 0.0
    paid = n * price
    realized = (won / paid * 100.0) if paid else 0.0
    drift = realized - target
    return AdminCaseStatsOut(
        case_id=case_id, total_opens=n,
        total_paid_ton=round(paid, 9), total_won_ton=round(won, 9),
        realized_rtp_pct=round(realized, 2), target_ev_pct=target,
        drift_pct=round(drift, 2),
    )
