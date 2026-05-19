"""Phase 7a — Crash round engine + WebSocket fan-out hub.

One global engine owns the round lifecycle. A single asyncio loop drives the
state machine; all WebSocket clients subscribe via the broadcast hub. The
loop ticks every TICK_INTERVAL_SEC (100 ms) during `running` to push the
current multiplier — auto-cashouts fire on these ticks too, so they fire
even if a client has disconnected.

Concurrency model:
  • All round-state mutations happen inside `_loop` or under `self._lock`.
  • Bet placement uses atomic CAS on users.balance_ton — safe under load.
  • Cashout uses an atomic `find_one_and_update` against `crash_bets` keyed by
    `bet_id + status="placed"` so concurrent cashouts on the same bet are
    impossible (Mongo's per-document atomicity is the lock).
  • Settlement on crash uses `update_many` per round_id+status="placed" to
    flip them to "lost" idempotently.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import deque
from datetime import timedelta
from typing import Any

from pymongo import ReturnDocument

from core.db import db, users_col
from core.time_utils import iso, now
from core.crash_engine import (
    PHASE_DURATIONS_SEC, TICK_INTERVAL_SEC,
    compute_payout, derive_client_seed_combined, derive_crash_multiplier,
    elapsed_to_reach, multiplier_at, sha256_hex,
    validate_auto_cashout, validate_bet_amount,
)

LOG = logging.getLogger("lydomania.crash")

rounds_col = db["crash_rounds"]
bets_col = db["crash_bets"]


class BetError(Exception):
    """Surface as 400 in the router."""


class CashoutError(Exception):
    """Surface as 400 in the router."""


# ─── Pub/sub hub ────────────────────────────────────────────────────────────
class _Hub:
    """Same pattern as the Roulette hub — back-pressure-friendly fan-out."""

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[dict[str, Any]]] = set()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subs.discard(q)

    def broadcast(self, msg: dict[str, Any]) -> None:
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for q in self._subs:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subs.discard(q)

    @property
    def size(self) -> int:
        return len(self._subs)


# ─── Engine singleton ───────────────────────────────────────────────────────
class CrashEngine:
    def __init__(self) -> None:
        self.hub = _Hub()
        self.current: dict[str, Any] | None = None
        self._loop_task: asyncio.Task | None = None
        self._stopped = False
        self._lock = asyncio.Lock()
        self.recent_results: deque[dict[str, Any]] = deque(maxlen=30)

    # ── public API ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        await self._cleanup_orphan_bets()
        await self._load_recent_results()
        self._loop_task = asyncio.create_task(self._loop(), name="crash_loop")
        LOG.info("crash engine started")

    async def stop(self) -> None:
        self._stopped = True
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

    def state_snapshot(self) -> dict[str, Any]:
        """Snapshot for HTTP /state and WS on-connect."""
        r = self.current or {}
        elapsed = 0.0
        live_x = 1.00
        if r.get("phase") == "running" and r.get("running_started_at_mono"):
            elapsed = time.monotonic() - r["running_started_at_mono"]
            live_x = round(multiplier_at(elapsed), 2)
        return {
            "type": "state",
            "round_id": r.get("round_id"),
            "phase": r.get("phase"),
            "phase_ends_at": r.get("phase_ends_at"),
            "phase_started_at": r.get("phase_started_at"),
            "server_seed_hash": r.get("server_seed_hash"),
            "server_seed_revealed": r.get("server_seed_revealed"),
            "client_seed_combined": r.get("client_seed_combined"),
            "crash_multiplier": r.get("crash_multiplier_revealed"),
            "live_multiplier": live_x,
            "running_started_at": r.get("running_started_at"),
            "bet_count": int(r.get("bet_count", 0)),
            "total_wagered_ton": float(r.get("total_wagered_ton", 0.0)),
            "recent_results": list(self.recent_results),
        }

    async def place_bet(
        self, user: dict, amount: float, auto_cashout_x: float | None,
    ) -> dict[str, Any]:
        ok, err = validate_bet_amount(amount)
        if not ok:
            raise BetError(err or "amount_invalid")
        ok, err = validate_auto_cashout(auto_cashout_x)
        if not ok:
            raise BetError(err or "auto_x_invalid")
        async with self._lock:
            r = self.current
            if not r:
                raise BetError("no_active_round")
            if r.get("phase") != "betting":
                raise BetError("not_in_betting_phase")
            bet_id = secrets.token_hex(12)
            updated = await users_col.find_one_and_update(
                {"id": user["id"], "balance_ton": {"$gte": float(amount)}},
                {"$inc": {"balance_ton": -float(amount)},
                 "$set": {"updated_at": iso(now())}},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0, "balance_ton": 1},
            )
            if not updated:
                raise BetError("insufficient_balance")
            placed_at = iso(now())
            bet_doc = {
                "bet_id": bet_id,
                "round_id": r["round_id"],
                "user_id": user["id"],
                "telegram_id": int(user.get("telegram_id") or 0),
                "username": user.get("username"),
                "photo_url": user.get("photo_url"),
                "amount_ton": float(amount),
                "auto_cashout_x": float(auto_cashout_x) if auto_cashout_x else None,
                "cashed_at_x": None,
                "payout_ton": 0.0,
                "placed_at": placed_at,
                "settled_at": None,
                "status": "placed",
            }
            await bets_col.insert_one(bet_doc)
            r["bet_ids"].append(bet_id)
            r["bet_count"] = int(r.get("bet_count", 0)) + 1
            r["total_wagered_ton"] = float(r.get("total_wagered_ton", 0.0)) + float(amount)
            self.hub.broadcast({
                "type": "new_bet",
                "round_id": r["round_id"],
                "bet_id": bet_id,
                "username": user.get("username"),
                "telegram_id": int(user.get("telegram_id") or 0),
                "photo_url": user.get("photo_url"),
                "amount_ton": float(amount),
                "auto_cashout_x": bet_doc["auto_cashout_x"],
                "bet_count": r["bet_count"],
                "total_wagered_ton": r["total_wagered_ton"],
            })
            return {
                "bet_id": bet_id,
                "balance_ton": float(updated["balance_ton"]),
                "round_id": r["round_id"],
                "amount_ton": float(amount),
                "auto_cashout_x": bet_doc["auto_cashout_x"],
            }

    async def cashout(self, user: dict, bet_id: str) -> dict[str, Any]:
        """Atomic cashout. Returns payout + post-credit balance.

        Race-safety:
          (1) Mongo `find_one_and_update` on {bet_id, status="placed"} → at most
              one process can flip placed→won.
          (2) Multiplier-at-time-of-call uses the same monotonic clock as the
              engine loop, so even if the loop ticked just after we read it,
              the worst case is a ~50 ms older multiplier — never a multiplier
              past the crash point (because the engine only flips phase to
              "crashed" inside its lock).
        """
        r = self.current
        if not r:
            raise CashoutError("no_active_round")
        if r.get("phase") != "running":
            raise CashoutError("not_running")
        elapsed = time.monotonic() - r["running_started_at_mono"]
        live_x = round(multiplier_at(elapsed), 2)
        crash_x = r["crash_multiplier"]      # private — not yet revealed publicly
        if live_x >= crash_x:
            # We are extremely close to / past the crash boundary; the loop will
            # mark this bet "lost" in the next tick.
            raise CashoutError("too_late")
        bet = await bets_col.find_one_and_update(
            {"bet_id": bet_id, "user_id": user["id"], "status": "placed"},
            {"$set": {
                "cashed_at_x": float(live_x),
                "payout_ton": compute_payout(0.0, 0.0),  # placeholder, set below
                "status": "cashed_pending",              # interim state — settle credits in commit
                "settled_at": iso(now()),
            }},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not bet:
            raise CashoutError("bet_not_found_or_already_settled")
        payout = compute_payout(float(bet["amount_ton"]), live_x)
        # Commit: flip cashed_pending → won + atomic credit balance.
        await bets_col.update_one(
            {"bet_id": bet_id, "status": "cashed_pending"},
            {"$set": {"payout_ton": payout, "status": "won"}},
        )
        new_user = await users_col.find_one_and_update(
            {"id": user["id"]},
            {"$inc": {"balance_ton": float(payout)},
             "$set": {"updated_at": iso(now())}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "balance_ton": 1},
        )
        self.hub.broadcast({
            "type": "cashout",
            "round_id": r["round_id"],
            "bet_id": bet_id,
            "user_id": user["id"],
            "username": user.get("username"),
            "photo_url": user.get("photo_url"),
            "cashed_at_x": float(live_x),
            "amount_ton": float(bet["amount_ton"]),
            "payout_ton": float(payout),
        })
        # Phase 7c — Battle Pass XP. Only if cashed above 1.00× (winning cashout).
        if float(live_x) > 1.00:
            try:
                from services.season import award_xp as _award_xp
                await _award_xp(
                    user["id"], int(float(bet["amount_ton"]) * 1),
                    "crash_cashout", bet_id,
                )
            except Exception as _e:  # noqa: BLE001
                LOG.warning("crash: season XP hook failed bet_id=%s: %s", bet_id, _e)
        return {
            "bet_id": bet_id,
            "cashed_at_x": float(live_x),
            "payout_ton": float(payout),
            "balance_ton": float(new_user["balance_ton"]) if new_user else 0.0,
        }

    # ── internals ─────────────────────────────────────────────────────────

    async def _cleanup_orphan_bets(self) -> None:
        """Mark any 'placed' bets from a previous restart as 'lost' (no double-crediting)."""
        res = await bets_col.update_many(
            {"status": {"$in": ["placed", "cashed_pending"]}},
            {"$set": {"status": "lost", "settled_at": iso(now())}},
        )
        if res.modified_count:
            LOG.warning("crash startup cleanup: %d orphan bets → lost", res.modified_count)

    async def _load_recent_results(self) -> None:
        cur = rounds_col.find(
            {"crash_multiplier_revealed": {"$exists": True}}, {"_id": 0},
        ).sort("ended_at", -1).limit(30)
        async for d in cur:
            self.recent_results.appendleft({
                "round_id": d["round_id"],
                "crash_multiplier": d.get("crash_multiplier_revealed"),
                "ended_at": d.get("ended_at"),
            })

    async def _new_round(self) -> dict[str, Any]:
        round_id = secrets.token_hex(8)
        server_seed = secrets.token_hex(32)
        started_at = now()
        return {
            "round_id": round_id,
            "server_seed": server_seed,                        # private
            "server_seed_hash": sha256_hex(server_seed),       # public commit
            "server_seed_revealed": None,                       # public after crash
            "client_seed_combined": None,
            "crash_multiplier": None,                           # computed at lock
            "crash_multiplier_revealed": None,                  # public after crash
            "bet_ids": [],
            "bet_count": 0,
            "total_wagered_ton": 0.0,
            "total_paid_ton": 0.0,
            "started_at": iso(started_at),
            "running_started_at": None,
            "running_started_at_mono": None,
            "ended_at": None,
            "phase": "betting",
            "phase_started_at": iso(started_at),
            "phase_ends_at": iso(started_at + timedelta(seconds=PHASE_DURATIONS_SEC["betting"])),
        }

    def _broadcast_phase(self, extra: dict | None = None) -> None:
        snap = self.state_snapshot()
        snap["type"] = "phase"
        snap.pop("recent_results", None)        # keep ticks light
        if extra:
            snap.update(extra)
        self.hub.broadcast(snap)

    async def _settle_losses(self, r: dict[str, Any]) -> None:
        """Flip every 'placed' or 'cashed_pending' bet for this round to 'lost'."""
        await bets_col.update_many(
            {"round_id": r["round_id"], "status": {"$in": ["placed", "cashed_pending"]}},
            {"$set": {"status": "lost", "settled_at": iso(now()), "payout_ton": 0.0}},
        )

    async def _persist_round(self, r: dict[str, Any]) -> None:
        """Persist final round doc (after crash) for verifier + history."""
        await rounds_col.update_one(
            {"round_id": r["round_id"]},
            {"$set": {
                "round_id": r["round_id"],
                "server_seed": r["server_seed"],
                "server_seed_hash": r["server_seed_hash"],
                "client_seed_combined": r["client_seed_combined"],
                "crash_multiplier_revealed": r["crash_multiplier"],
                "bet_ids": r["bet_ids"],
                "bet_count": r["bet_count"],
                "total_wagered_ton": r["total_wagered_ton"],
                "total_paid_ton": r["total_paid_ton"],
                "started_at": r["started_at"],
                "running_started_at": r["running_started_at"],
                "ended_at": r["ended_at"],
            }},
            upsert=True,
        )

    async def _loop(self) -> None:
        """One round per iteration: betting → running → crashed → repeat."""
        while not self._stopped:
            try:
                await self._run_one_round()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                LOG.exception("crash loop crashed — restarting in 2s")
                await asyncio.sleep(2.0)

    async def _run_one_round(self) -> None:
        # ── BETTING ──────────────────────────────────────────────────────
        async with self._lock:
            self.current = await self._new_round()
        r = self.current
        self._broadcast_phase()
        await asyncio.sleep(PHASE_DURATIONS_SEC["betting"])

        # ── LOCK: derive crash_multiplier ───────────────────────────────
        async with self._lock:
            r["client_seed_combined"] = derive_client_seed_combined(r["bet_ids"])
            r["crash_multiplier"] = derive_crash_multiplier(
                r["server_seed"], r["round_id"], r["client_seed_combined"],
            )
            r["phase"] = "running"
            r["running_started_at"] = iso(now())
            r["running_started_at_mono"] = time.monotonic()
            r["phase_started_at"] = r["running_started_at"]
            # phase_ends_at is unknown for `running` (depends on crash point);
            # client interpolates the multiplier from elapsed time anyway.
            r["phase_ends_at"] = None
        self._broadcast_phase()

        # ── RUNNING: tick at TICK_HZ, handle auto-cashouts, crash on reach ─
        crash_x = r["crash_multiplier"]
        target_elapsed = elapsed_to_reach(crash_x)
        next_tick = time.monotonic()
        while True:
            now_mono = time.monotonic()
            if now_mono < next_tick:
                await asyncio.sleep(max(0.0, next_tick - now_mono))
            now_mono = time.monotonic()
            elapsed = now_mono - r["running_started_at_mono"]
            live_x = round(multiplier_at(elapsed), 2)
            # Auto-cashout sweep: any 'placed' bet whose `auto_cashout_x` ≤ live_x
            # (and below crash_x) is settled NOW. The same atomic update used by
            # interactive cashouts guarantees no double-credit.
            await self._auto_cashout_sweep(r, live_x, crash_x)
            # Crash?
            if elapsed >= target_elapsed:
                break
            # Live multiplier broadcast
            self.hub.broadcast({
                "type": "tick",
                "round_id": r["round_id"],
                "multiplier": live_x,
                "elapsed_sec": round(elapsed, 3),
            })
            next_tick += TICK_INTERVAL_SEC
            # Yield aggressively under heavy load
            await asyncio.sleep(0)

        # ── CRASH ────────────────────────────────────────────────────────
        async with self._lock:
            r["phase"] = "crashed"
            r["crash_multiplier_revealed"] = crash_x
            r["server_seed_revealed"] = r["server_seed"]
            r["ended_at"] = iso(now())
            r["phase_started_at"] = r["ended_at"]
            r["phase_ends_at"] = iso(now() + timedelta(seconds=PHASE_DURATIONS_SEC["crashed"]))
            await self._settle_losses(r)
            # Compute total_paid_ton from bet docs
            agg = bets_col.aggregate([
                {"$match": {"round_id": r["round_id"], "status": "won"}},
                {"$group": {"_id": None, "total": {"$sum": "$payout_ton"}}},
            ])
            tot = 0.0
            async for d in agg:
                tot = float(d.get("total") or 0.0)
            r["total_paid_ton"] = tot
            await self._persist_round(r)
            self.recent_results.appendleft({
                "round_id": r["round_id"],
                "crash_multiplier": crash_x,
                "ended_at": r["ended_at"],
            })
        self._broadcast_phase({
            "crash_multiplier": crash_x,
            "server_seed_revealed": r["server_seed_revealed"],
        })
        await asyncio.sleep(PHASE_DURATIONS_SEC["crashed"])

    async def _auto_cashout_sweep(
        self, r: dict[str, Any], live_x: float, crash_x: float,
    ) -> None:
        # Cap the cashout point at live_x but never above crash_x-ε.
        # If a player set `auto_cashout_x = 4.0` and live_x just reached 4.01,
        # they should be paid at exactly 4.0 (not 4.01).
        # We query first to find eligible bets so we can compute the exact x per-bet.
        cur = bets_col.find(
            {
                "round_id": r["round_id"],
                "status": "placed",
                "auto_cashout_x": {"$ne": None, "$lte": live_x},
            },
            {"_id": 0, "bet_id": 1, "user_id": 1, "username": 1, "photo_url": 1,
             "amount_ton": 1, "auto_cashout_x": 1},
        )
        async for bet in cur:
            target_x = float(bet["auto_cashout_x"])
            if target_x >= crash_x:
                # Their auto-cashout is past the crash — they lose. Skip.
                continue
            # Atomic flip placed → won (with payout)
            payout = compute_payout(float(bet["amount_ton"]), target_x)
            flipped = await bets_col.find_one_and_update(
                {"bet_id": bet["bet_id"], "status": "placed"},
                {"$set": {
                    "cashed_at_x": target_x,
                    "payout_ton": payout,
                    "status": "won",
                    "settled_at": iso(now()),
                }},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0},
            )
            if not flipped:
                continue                # someone else flipped first (interactive cashout)
            await users_col.update_one(
                {"id": bet["user_id"]},
                {"$inc": {"balance_ton": payout},
                 "$set": {"updated_at": iso(now())}},
            )
            self.hub.broadcast({
                "type": "cashout",
                "round_id": r["round_id"],
                "bet_id": bet["bet_id"],
                "user_id": bet["user_id"],
                "username": bet.get("username"),
                "photo_url": bet.get("photo_url"),
                "cashed_at_x": target_x,
                "amount_ton": float(bet["amount_ton"]),
                "payout_ton": float(payout),
                "auto": True,
            })
            # Phase 7c — Battle Pass XP (auto-cashout path). Always > 1.00× by construction.
            try:
                from services.season import award_xp as _award_xp
                await _award_xp(
                    bet["user_id"], int(float(bet["amount_ton"]) * 1),
                    "crash_cashout", bet["bet_id"],
                )
            except Exception as _e:  # noqa: BLE001
                LOG.warning("crash: season XP hook failed bet_id=%s: %s", bet["bet_id"], _e)


engine = CrashEngine()
