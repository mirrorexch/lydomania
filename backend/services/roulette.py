"""
Phase 6c — Roulette round engine (state machine + broadcast hub).

Single global engine owns the round lifecycle. One asyncio loop drives the
state machine; all WebSocket connections subscribe via the broadcast hub
and receive phase deltas + bet events.

Lifecycle per round (35s total):
    betting  → 20s · accept bets
    locking  → 2s  · freeze bets, derive client_seed_combined + segment_index
    spinning → 8s  · clients animate; segment_index visible
    payout   → 5s  · winners credited; result frozen on screen

Concurrency model:
    • All round-state mutations happen inside `_loop` only.
    • Bet placement uses atomic CAS on users.balance_ton (find_one_and_update
      with $gte guard) — safe even if many users bet at once.
    • Settlement on payout uses atomic $inc credits per winning bet,
      idempotent via bet.status transition placed → won|lost.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections import deque
from datetime import timedelta
from typing import Any

from pymongo import ReturnDocument

from core.config import ROULETTE_PRIZE_MODE
from core.db import db, inventory_col, items_col, users_col
from core.time_utils import iso, now
from core.roulette_engine import (
    BET_TIERS, PHASE_DURATIONS_SEC, derive_client_seed_combined, derive_item_pick,
    derive_segment_index, color_for_index, payout_multiplier, sha256_hex,
    validate_bet_tier, validate_color,
)

LOG = logging.getLogger("lydomania.roulette")

rounds_col = db["roulette_rounds"]
bets_col = db["roulette_bets"]
control_col = db["roulette_control"]   # admin pause toggle
baskets_col = db["roulette_baskets"]   # Phase 6e


class _Hub:
    """Pub/sub for WebSocket fan-out. Each subscriber gets its own queue."""

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[dict[str, Any]]] = set()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
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


class RouletteEngine:
    """Singleton — start once via `start_roulette_engine(loop)` in lifespan."""

    def __init__(self) -> None:
        self.hub = _Hub()
        self.current: dict[str, Any] | None = None  # in-flight round
        self._loop_task: asyncio.Task | None = None
        self.recent_results: deque[dict[str, Any]] = deque(maxlen=20)
        self.bets_feed: deque[dict[str, Any]] = deque(maxlen=20)
        self._stopped = False
        self._lock = asyncio.Lock()

    # ─── public API ──────────────────────────────────────────────────────

    async def start(self) -> None:
        await self._load_recent_results()
        self._loop_task = asyncio.create_task(self._loop(), name="roulette_loop")
        LOG.info("roulette engine started")

    async def stop(self) -> None:
        self._stopped = True
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

    def state_snapshot(self) -> dict[str, Any]:
        r = self.current or {}
        return {
            "type": "state",
            "round_id": r.get("round_id"),
            "phase": r.get("phase"),
            "phase_ends_at": r.get("phase_ends_at"),
            "phase_started_at": r.get("phase_started_at"),
            "server_seed_hash": r.get("server_seed_hash"),
            "server_seed_revealed": r.get("server_seed_revealed"),
            "client_seed_combined": r.get("client_seed_combined"),
            "segment_index": r.get("segment_index"),
            "winning_color": r.get("winning_color"),
            "totals": dict(r.get("totals", {"red": 0.0, "black": 0.0, "green": 0.0})),
            "bet_count": int(r.get("bet_count", 0)),
            "recent_results": list(self.recent_results),
            "bets_feed": list(self.bets_feed),
        }

    async def place_bet(
        self, user: dict, round_id: str, color: str, amount: float,
    ) -> dict[str, Any]:
        """Validate + atomically debit + persist bet + broadcast."""
        if not validate_color(color):
            raise BetError("invalid_color")
        ok, err = validate_bet_tier(amount)
        if not ok:
            raise BetError(err or "invalid_tier")
        async with self._lock:
            r = self.current
            if not r or r.get("round_id") != round_id:
                raise BetError("round_changed")
            if r.get("phase") != "betting":
                raise BetError("not_in_betting_phase")
            bet_id = secrets.token_hex(12)
            # Atomic balance debit
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
                "round_id": round_id,
                "user_id": user["id"],
                "telegram_id": int(user.get("telegram_id") or 0),
                "username": user.get("username"),
                "color": color,
                "amount_ton": float(amount),
                "payout_ton": 0.0,
                "placed_at": placed_at,
                "settled_at": None,
                "status": "placed",
            }
            await bets_col.insert_one(bet_doc)
            r["bet_ids"].append(bet_id)
            r["totals"][color] = r["totals"].get(color, 0.0) + float(amount)
            r["bet_count"] = int(r.get("bet_count", 0)) + 1
            feed_event = {
                "type": "new_bet",
                "round_id": round_id,
                "bet_id": bet_id,
                "username": user.get("username"),
                "telegram_id": int(user.get("telegram_id") or 0),
                "photo_url": user.get("photo_url"),
                "color": color,
                "amount_ton": float(amount),
                "placed_at": placed_at,
                "totals": dict(r["totals"]),
                "bet_count": r["bet_count"],
            }
            self.bets_feed.appendleft(feed_event)
            self.hub.broadcast(feed_event)
            return {
                "bet_id": bet_id,
                "balance_ton": float(updated["balance_ton"]),
                "round_id": round_id,
                "color": color,
                "amount_ton": float(amount),
            }

    # ─── internals ───────────────────────────────────────────────────────

    async def _load_recent_results(self) -> None:
        cur = rounds_col.find(
            {"server_seed": {"$exists": True}}, {"_id": 0},
        ).sort("ended_at", -1).limit(20)
        async for doc in cur:
            self.recent_results.appendleft({
                "round_id": doc["round_id"],
                "winning_color": doc.get("winning_color"),
                "segment_index": doc.get("segment_index"),
                "ended_at": doc.get("ended_at"),
            })

    async def _is_paused(self) -> bool:
        doc = await control_col.find_one({"id": "control"}, {"_id": 0, "paused": 1})
        return bool(doc and doc.get("paused"))

    async def _new_round(self) -> dict[str, Any]:
        round_id = secrets.token_hex(8)
        server_seed = secrets.token_hex(32)
        server_seed_hash = sha256_hex(server_seed)
        started_at = now()
        return {
            "round_id": round_id,
            "server_seed": server_seed,
            "server_seed_hash": server_seed_hash,
            "server_seed_revealed": None,
            "client_seed_combined": None,
            "segment_index": None,
            "winning_color": None,
            "bet_ids": [],
            "totals": {"red": 0.0, "black": 0.0, "green": 0.0},
            "bet_count": 0,
            "started_at": iso(started_at),
            "ended_at": None,
            "phase": "betting",
            "phase_started_at": iso(started_at),
            "phase_ends_at": iso(started_at + timedelta(seconds=PHASE_DURATIONS_SEC["betting"])),
        }

    def _broadcast_phase(self) -> None:
        # Snapshot without bets_feed (smaller); WS sends bets_feed separately
        snap = self.state_snapshot()
        snap["type"] = "phase"
        snap.pop("bets_feed", None)
        self.hub.broadcast(snap)

    async def _settle_round(self, r: dict[str, Any]) -> None:
        """Credit winners. Phase 6e:
          * mode="gifts" → winners get one item from the (tier, color) basket via
            deterministic HMAC pick → inserted into `inventory` (status=in_inventory,
            case_id="roulette"). NO TON payout. Bet doc records `winning_item_slug`.
          * mode="ton"   → legacy `payout_ton = amount × multiplier` path.
        Idempotent: bet.status placed → won|lost.
        """
        winning_color = r["winning_color"]
        total_pot = sum(r["totals"].values())
        total_payout = 0.0  # TON paid (legacy mode)
        total_basket_floor_ton = 0.0  # sum of floors of awarded gifts (gift mode)
        win_count = 0
        items_awarded: list[dict[str, Any]] = []

        # Pre-load baskets keyed by (tier, color) so we don't hit Mongo per bet
        baskets_map: dict[tuple[float, str], dict] = {}
        if ROULETTE_PRIZE_MODE == "gifts":
            async for b in baskets_col.find({}, {"_id": 0}):
                baskets_map[(float(b["tier"]), b["color"])] = b

        cur = bets_col.find(
            {"round_id": r["round_id"], "status": "placed"}, {"_id": 0},
        )
        async for bet in cur:
            if bet["color"] != winning_color:
                await bets_col.update_one(
                    {"bet_id": bet["bet_id"], "status": "placed"},
                    {"$set": {"status": "lost", "settled_at": iso(now())}},
                )
                continue

            win_count += 1
            if ROULETTE_PRIZE_MODE == "gifts":
                basket = baskets_map.get((float(bet["amount_ton"]), winning_color))
                if not basket or not basket.get("items"):
                    LOG.warning("no basket for tier=%s color=%s — falling back to TON payout",
                                bet["amount_ton"], winning_color)
                    payout = bet["amount_ton"] * payout_multiplier(winning_color)
                    total_payout += payout
                    upd_bet = await bets_col.find_one_and_update(
                        {"bet_id": bet["bet_id"], "status": "placed"},
                        {"$set": {"status": "won", "payout_ton": payout,
                                  "winning_item_slug": None, "settled_at": iso(now())}},
                        return_document=ReturnDocument.AFTER,
                    )
                    if upd_bet:
                        await users_col.update_one(
                            {"id": bet["user_id"]},
                            {"$inc": {"balance_ton": payout},
                             "$set": {"updated_at": iso(now())}},
                        )
                    continue

                pick = derive_item_pick(
                    r["server_seed"], r["round_id"], bet["bet_id"], basket["items"],
                )
                item_doc = await items_col.find_one({"slug": pick["item_slug"]}, {"_id": 0})
                if not item_doc:
                    LOG.warning("basket item slug %s not in items col — skipping award", pick["item_slug"])
                    await bets_col.update_one(
                        {"bet_id": bet["bet_id"], "status": "placed"},
                        {"$set": {"status": "lost", "settled_at": iso(now()),
                                  "settle_error": f"missing_item:{pick['item_slug']}"}},
                    )
                    continue

                inv_id = secrets.token_hex(12)
                floor = float(item_doc.get("floor_price_ton") or 0.0)
                inv_doc = {
                    "id": inv_id,
                    "user_id": bet["user_id"],
                    "item_slug": item_doc["slug"],
                    "item_name": item_doc.get("name", item_doc["slug"]),
                    "rarity": item_doc.get("rarity", "common"),
                    "image_path": item_doc.get("image_path", f"items/{item_doc['slug']}.png"),
                    "payout_ton": floor,
                    "status": "in_inventory",
                    "case_id": "roulette",
                    "roll_id": f"roulette_{r['round_id']}_{bet['bet_id']}",
                    "source": "roulette",
                    "created_at": iso(now()),
                }
                upd_bet = await bets_col.find_one_and_update(
                    {"bet_id": bet["bet_id"], "status": "placed"},
                    {"$set": {
                        "status": "won",
                        "payout_ton": 0.0,
                        "winning_item_slug": item_doc["slug"],
                        "winning_item_name": item_doc.get("name"),
                        "winning_item_floor_ton": floor,
                        "winning_inventory_id": inv_id,
                        "settled_at": iso(now()),
                    }},
                    return_document=ReturnDocument.AFTER,
                )
                if upd_bet:
                    await inventory_col.insert_one(inv_doc)
                    total_basket_floor_ton += floor
                    items_awarded.append({
                        "bet_id": bet["bet_id"],
                        "user_id": bet["user_id"],
                        "item_slug": item_doc["slug"],
                        "floor_ton": floor,
                    })
            else:
                # Legacy TON-payout path
                payout = bet["amount_ton"] * payout_multiplier(winning_color)
                total_payout += payout
                upd_bet = await bets_col.find_one_and_update(
                    {"bet_id": bet["bet_id"], "status": "placed"},
                    {"$set": {"status": "won", "payout_ton": payout,
                              "settled_at": iso(now())}},
                    return_document=ReturnDocument.AFTER,
                )
                if upd_bet:
                    await users_col.update_one(
                        {"id": bet["user_id"]},
                        {"$inc": {"balance_ton": payout},
                         "$set": {"updated_at": iso(now())}},
                    )

        r["total_pot_ton"] = round(total_pot, 6)
        r["total_payout_ton"] = round(total_payout, 6)
        r["total_basket_floor_ton"] = round(total_basket_floor_ton, 6)
        r["win_count"] = win_count
        r["items_awarded"] = items_awarded
        r["prize_mode"] = ROULETTE_PRIZE_MODE

    async def _persist_round(self, r: dict[str, Any]) -> None:
        doc = {
            "round_id": r["round_id"],
            "started_at": r["started_at"],
            "ended_at": r["ended_at"],
            "server_seed": r["server_seed"],
            "server_seed_hash": r["server_seed_hash"],
            "client_seed_combined": r["client_seed_combined"],
            "segment_index": r["segment_index"],
            "winning_color": r["winning_color"],
            "bet_count": r["bet_count"],
            "bet_ids": r["bet_ids"],
            "totals": r["totals"],
            "total_pot_ton": r.get("total_pot_ton", 0.0),
            "total_payout_ton": r.get("total_payout_ton", 0.0),
            "total_basket_floor_ton": r.get("total_basket_floor_ton", 0.0),
            "items_awarded": r.get("items_awarded", []),
            "prize_mode": r.get("prize_mode", ROULETTE_PRIZE_MODE),
            "win_count": r.get("win_count", 0),
        }
        await rounds_col.update_one(
            {"round_id": r["round_id"]}, {"$set": doc}, upsert=True,
        )

    async def _loop(self) -> None:
        """The single source of truth for round state."""
        while not self._stopped:
            try:
                if await self._is_paused():
                    self.current = None
                    self.hub.broadcast({"type": "paused"})
                    await asyncio.sleep(2.0)
                    continue
                # 1) BETTING
                r = await self._new_round()
                async with self._lock:
                    self.current = r
                self._broadcast_phase()
                await asyncio.sleep(PHASE_DURATIONS_SEC["betting"])
                # 2) LOCKING — derive seed combo + segment
                async with self._lock:
                    r["phase"] = "locking"
                    r["phase_started_at"] = iso(now())
                    r["phase_ends_at"] = iso(now() + timedelta(seconds=PHASE_DURATIONS_SEC["locking"]))
                    r["client_seed_combined"] = derive_client_seed_combined(r["bet_ids"])
                    r["segment_index"] = derive_segment_index(
                        r["server_seed"], r["client_seed_combined"], r["round_id"],
                    )
                    r["winning_color"] = color_for_index(r["segment_index"])
                self._broadcast_phase()
                await asyncio.sleep(PHASE_DURATIONS_SEC["locking"])
                # 3) SPINNING — clients animate; we reveal the segment now
                async with self._lock:
                    r["phase"] = "spinning"
                    r["phase_started_at"] = iso(now())
                    r["phase_ends_at"] = iso(now() + timedelta(seconds=PHASE_DURATIONS_SEC["spinning"]))
                self._broadcast_phase()
                await asyncio.sleep(PHASE_DURATIONS_SEC["spinning"])
                # 4) PAYOUT — settle, reveal seed, persist round
                await self._settle_round(r)
                async with self._lock:
                    r["phase"] = "payout"
                    r["phase_started_at"] = iso(now())
                    r["phase_ends_at"] = iso(now() + timedelta(seconds=PHASE_DURATIONS_SEC["payout"]))
                    r["server_seed_revealed"] = r["server_seed"]
                    r["ended_at"] = iso(now())
                await self._persist_round(r)
                self.recent_results.appendleft({
                    "round_id": r["round_id"],
                    "winning_color": r["winning_color"],
                    "segment_index": r["segment_index"],
                    "ended_at": r["ended_at"],
                })
                self._broadcast_phase()
                self.hub.broadcast({
                    "type": "round_settled",
                    "round_id": r["round_id"],
                    "winning_color": r["winning_color"],
                    "segment_index": r["segment_index"],
                    "server_seed": r["server_seed_revealed"],
                    "client_seed_combined": r["client_seed_combined"],
                    "total_pot_ton": r.get("total_pot_ton"),
                    "total_payout_ton": r.get("total_payout_ton"),
                    "win_count": r.get("win_count"),
                })
                await asyncio.sleep(PHASE_DURATIONS_SEC["payout"])
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                LOG.exception("roulette loop crashed — pausing 5s then restarting")
                await asyncio.sleep(5.0)


class BetError(Exception):
    pass


engine = RouletteEngine()
