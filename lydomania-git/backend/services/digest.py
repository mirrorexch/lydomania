"""
Phase 4a — Daily variance digest + Sync-All admin digest.

Aggregates the last 24h of operator-facing metrics from MongoDB and emits a
Telegram-HTML formatted summary to the notifications outbox.

Two delivery paths:
  • build_daily_digest()  → DM every admin at settings.digest_hour_utc each day
  • build_sync_summary()  → DM the triggering admin right after a Sync-All apply

Both produce a single compact message; long lists are truncated to 5 rows.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from core.config import ADMIN_TELEGRAM_IDS, logger
from core.db import (
    auto_fulfill_log_col, cases_col, deposits_col, gift_floor_prices_col,
    items_col, rolls_col, users_col, withdrawals_col,
)
from core.time_utils import iso, now
from services.notifications import enqueue_notification

WINDOW_HOURS_DEFAULT = 24
TRUNCATE = 5


def _short(s: str, n: int = 16) -> str:
    return s if len(s) <= n else (s[: n - 1] + "…")


async def _floor_drifts(top_n: int = TRUNCATE) -> list[dict[str, Any]]:
    """Items whose live floor diverges most from configured (signed pct)."""
    items: dict[str, dict] = {}
    async for i in items_col.find({}, {"_id": 0, "slug": 1, "name": 1, "floor_price_ton": 1}):
        items[i["slug"]] = i
    rows: list[dict[str, Any]] = []
    async for f in gift_floor_prices_col.find({"floor_ton": {"$ne": None}}, {"_id": 0}):
        cfg = float(items.get(f["slug"], {}).get("floor_price_ton") or 0)
        live = float(f.get("floor_ton") or 0)
        if cfg <= 0 or live <= 0:
            continue
        drift = (live - cfg) / cfg * 100.0
        rows.append({
            "slug": f["slug"],
            "name": items.get(f["slug"], {}).get("name", f["slug"]),
            "configured": cfg, "live": live, "drift_pct": drift,
        })
    rows.sort(key=lambda r: -abs(r["drift_pct"]))
    return rows[:top_n]


async def _auto_fulfill_volume(since_iso: str) -> dict[str, Any]:
    """Sum of payout_ton + count for successful (non-dry-run) fulfillments + cooldowns/failures in window."""
    pipe = [
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$group": {"_id": "$kind", "n": {"$sum": 1}, "v": {"$sum": {"$ifNull": ["$payout_ton", 0]}}}},
    ]
    out = {"success_ton": 0.0, "success_n": 0, "failure_n": 0, "dry_run_n": 0, "cooldown_n": 0}
    async for d in auto_fulfill_log_col.aggregate(pipe):
        k = d["_id"]
        if k == "auto_fulfill_success":
            out["success_ton"] = float(d.get("v") or 0); out["success_n"] = int(d["n"])
        elif k == "auto_fulfill_failure":
            out["failure_n"] = int(d["n"])
        elif k == "dry_run_success":
            out["dry_run_n"] = int(d["n"])
        elif k == "cooldown_triggered":
            out["cooldown_n"] = int(d["n"])
    return out


async def _biggest_wins(since_iso: str, top_n: int = TRUNCATE) -> list[dict[str, Any]]:
    cur = rolls_col.find(
        {"created_at": {"$gte": since_iso}, "payout_ton": {"$gt": 0}},
        {"_id": 0, "user_id": 1, "case_id": 1, "payout_ton": 1, "winning_item_slug": 1, "created_at": 1},
    ).sort("payout_ton", -1).limit(top_n)
    rows: list[dict[str, Any]] = []
    async for d in cur:
        rows.append(d)
    return rows


async def _flow_totals(since_iso: str) -> dict[str, Any]:
    """Deposits credited + withdrawals requested + fulfilled in window."""
    out: dict[str, Any] = {
        "deposits_n": 0, "deposits_ton": 0.0,
        "withdrawals_requested_n": 0, "withdrawals_requested_ton": 0.0,
        "withdrawals_fulfilled_n": 0, "withdrawals_fulfilled_ton": 0.0,
    }
    pipe_d = [
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "v": {"$sum": "$amount_ton"}}},
    ]
    async for d in deposits_col.aggregate(pipe_d):
        out["deposits_n"] = int(d["n"]); out["deposits_ton"] = float(d.get("v") or 0)
    pipe_wr = [
        {"$match": {"requested_at": {"$gte": since_iso}}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "v": {"$sum": "$payout_ton"}}},
    ]
    async for d in withdrawals_col.aggregate(pipe_wr):
        out["withdrawals_requested_n"] = int(d["n"]); out["withdrawals_requested_ton"] = float(d.get("v") or 0)
    pipe_wf = [
        {"$match": {"fulfilled_at": {"$gte": since_iso}, "status": "fulfilled"}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "v": {"$sum": "$payout_ton"}}},
    ]
    async for d in withdrawals_col.aggregate(pipe_wf):
        out["withdrawals_fulfilled_n"] = int(d["n"]); out["withdrawals_fulfilled_ton"] = float(d.get("v") or 0)
    return out


async def _case_drift_summary() -> list[dict[str, Any]]:
    """Per-case theoretical EV vs configured target (helps spot mis-recalibrated cases)."""
    rows: list[dict[str, Any]] = []
    async for c in cases_col.find({"enabled": True}, {"_id": 0}).sort("price_ton", 1):
        basket = c.get("basket", [])
        if not basket:
            continue
        tw = sum(float(b.get("weight", 0)) for b in basket)
        if tw <= 0:
            continue
        ev = sum(float(b["payout_ton"]) * float(b["weight"]) / tw for b in basket)
        price = float(c.get("price_ton", 0))
        if price <= 0:
            continue
        pct = ev / price * 100.0
        target = float(c.get("target_ev_pct", 90.0))
        rows.append({
            "case_id": c["id"], "name": c["name"], "target_pct": target,
            "realized_pct": pct, "drift_pct": pct - target,
        })
    return rows


async def build_daily_digest(window_hours: int = WINDOW_HOURS_DEFAULT) -> dict[str, Any]:
    """Collect numbers and format a single HTML message string.

    Returns {text, stats} so the caller can fan-out to admins.
    """
    since = (now() - timedelta(hours=window_hours))
    since_iso_str = iso(since)
    drifts = await _floor_drifts()
    autoful = await _auto_fulfill_volume(since_iso_str)
    wins = await _biggest_wins(since_iso_str)
    flows = await _flow_totals(since_iso_str)
    cases = await _case_drift_summary()
    new_users_n = await users_col.count_documents({"created_at": {"$gte": since_iso_str}})

    lines: list[str] = []
    lines.append(f"📊 <b>Lydomania · {window_hours}h digest</b>")
    lines.append(f"<i>{since.strftime('%Y-%m-%d %H:%M UTC')} → now</i>\n")
    lines.append("<b>💸 Money flow</b>")
    lines.append(f"  Deposits: <b>{flows['deposits_ton']:,.2f} TON</b> · {flows['deposits_n']} tx")
    lines.append(f"  Withdraw req: <b>{flows['withdrawals_requested_ton']:,.2f} TON</b> · {flows['withdrawals_requested_n']} tx")
    lines.append(f"  Withdraw paid: <b>{flows['withdrawals_fulfilled_ton']:,.2f} TON</b> · {flows['withdrawals_fulfilled_n']} tx")
    lines.append(f"  New users: <b>{new_users_n}</b>\n")

    lines.append("<b>🏦 Auto-fulfill</b>")
    lines.append(f"  Real ✓: {autoful['success_n']} · {autoful['success_ton']:,.2f} TON")
    lines.append(f"  Real ✗: {autoful['failure_n']}  · Dry-run: {autoful['dry_run_n']}")
    if autoful["cooldown_n"]:
        lines.append(f"  ⚠️ Cooldowns triggered: <b>{autoful['cooldown_n']}</b>")
    lines.append("")

    if wins:
        lines.append("<b>🎯 Biggest wins (24h)</b>")
        for w in wins:
            slug = _short(w.get("winning_item_slug", "?"), 22)
            lines.append(f"  {slug} · <b>{float(w['payout_ton']):,.1f} TON</b> ({w.get('case_id','?')})")
        lines.append("")

    if drifts:
        lines.append("<b>📉 Top floor drifts</b>")
        for d in drifts:
            arrow = "▲" if d["drift_pct"] > 0 else "▼"
            lines.append(
                f"  {_short(d['name'], 18)} · cfg {d['configured']:.1f} → live {d['live']:.1f} {arrow} {abs(d['drift_pct']):.0f}%"
            )
        lines.append("")

    if cases:
        lines.append("<b>🎰 Case RTP (theoretical)</b>")
        for c in cases:
            mark = "✅" if abs(c["drift_pct"]) < 0.5 else ("🟡" if abs(c["drift_pct"]) < 2 else "🔴")
            lines.append(
                f"  {mark} {c['case_id']:<14s} target {c['target_pct']:.1f}%  real {c['realized_pct']:.2f}%  Δ {c['drift_pct']:+.2f}%"
            )

    text = "\n".join(lines)
    return {
        "text": text,
        "stats": {
            "deposits_ton": flows["deposits_ton"], "deposits_n": flows["deposits_n"],
            "withdrawals_requested_ton": flows["withdrawals_requested_ton"],
            "withdrawals_fulfilled_ton": flows["withdrawals_fulfilled_ton"],
            "auto_fulfill_success_ton": autoful["success_ton"],
            "auto_fulfill_failures": autoful["failure_n"],
            "cooldowns": autoful["cooldown_n"],
            "new_users": new_users_n,
            "biggest_wins_count": len(wins),
            "top_drifts_count": len(drifts),
        },
    }


async def send_daily_digest_to_admins() -> dict[str, Any]:
    """Build and enqueue the daily digest to every admin TG ID."""
    payload = await build_daily_digest()
    text = payload["text"]
    sent = 0
    for tid in ADMIN_TELEGRAM_IDS:
        try:
            await enqueue_notification(int(tid), text, kind="daily_digest")
            sent += 1
        except Exception as e:
            logger.warning("digest enqueue failed for tid=%s: %s", tid, e)
    return {"sent": sent, "admins": list(ADMIN_TELEGRAM_IDS), "stats": payload["stats"]}


# ---------- Sync-All admin DM ----------

async def build_sync_summary(report: dict[str, Any]) -> str:
    """Format a compact HTML digest of a `POST /admin/maintenance/sync-all` report."""
    watch = report.get("watch") or {}
    items_sync = report.get("items_sync") or {}
    cases = report.get("cases_recalib") or {}
    applied = bool(report.get("applied"))
    cap_mult = report.get("max_payout_multiplier")

    lines: list[str] = []
    lines.append(f"🔄 <b>Sync All · {'APPLIED' if applied else 'preview'}</b>")
    if watch.get("skipped"):
        lines.append(f"  watch: <i>skipped — {watch.get('reason')}</i>")
    else:
        lines.append(f"  watch: <b>{watch.get('ok', 0)}/{watch.get('total', 0)} OK</b> in {watch.get('duration_s', 0)}s")
    lines.append(f"  items updated: <b>{items_sync.get('items_updated', 0)}</b>")
    lines.append(f"  cases recalibrated: <b>{cases.get('cases_ok', 0)}/{cases.get('cases_total', 0)}</b>  cap=×{cap_mult}\n")

    reports = cases.get("reports", []) or []
    if reports:
        lines.append("<b>Per-case</b>")
        for r in reports:
            if r.get("ok"):
                drift = r.get("drift_pct") or 0
                lines.append(
                    f"  ✅ {r['case_id']:<14s} EV={r.get('realized_ev_pct'):.2f}% Δ{drift:+.2f}% "
                    f"kept={r.get('kept_count')} drop={r.get('dropped_count')} mode={r.get('weight_mode')}"
                )
            else:
                lines.append(f"  ❌ {r['case_id']}: {_short(r.get('error', '?'), 70)}")

    # Top diffs from items_sync (sorted by % change)
    diffs = items_sync.get("diffs", []) or []
    if diffs:
        ranked = sorted(
            diffs,
            key=lambda x: -abs((float(x.get("new", 0)) - float(x.get("old", 0))) / max(1.0, float(x.get("old") or 1))),
        )[:5]
        lines.append("\n<b>Top floor moves</b>")
        for d in ranked:
            old = float(d.get("old") or 0); new = float(d.get("new") or 0)
            if old > 0:
                pct = (new - old) / old * 100.0
                arrow = "▲" if pct > 0 else "▼"
                lines.append(f"  {_short(d['slug'], 18)} · {old:.1f} → {new:.1f} {arrow}{abs(pct):.0f}%")
            else:
                lines.append(f"  {_short(d['slug'], 18)} · {old:.1f} → {new:.1f}")
    return "\n".join(lines)


async def send_sync_summary_dm(admin_telegram_id: int, report: dict[str, Any]) -> None:
    text = await build_sync_summary(report)
    await enqueue_notification(int(admin_telegram_id), text, kind="sync_all_digest")
