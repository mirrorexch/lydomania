"""
Phase 6d — Case Battles service.

Owns:
    • battle creation / join / leave (atomic balance debit + seat claim)
    • match runner (one asyncio task per active battle)
    • per-battle WS broadcast hub + a global lobby hub
    • atomic settlement on completion (pot credit to winner(s))

Concurrency:
    • Seats are an embedded array inside `battles`. Atomic claim is done
      via Mongo `find_one_and_update` with arrayFilters. First writer wins,
      losers retry.
    • Balance debit/credit uses the same atomic CAS pattern as Roulette
      (find_one_and_update with $gte guard on balance_ton).
    • Match runner is idempotent: if the process restarts, on boot we
      scan for battles in `ready`/`rolling` and resume / cancel them safely.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Any

from pymongo import ReturnDocument

from core.battles_engine import (
    COUNTDOWN_SEC, HOUSE_RAKE_DEFAULT_PCT, ROUND_REVEAL_SEC,
    clamp_rake, compute_entry_ton, compute_payout_pool_ton,
    compute_pot_ton, derive_item_pick, determine_winners, split_payout,
    validate_case_sequence, validate_mode, validate_players,
)
from core.db import db, users_col
from core.time_utils import iso, now

LOG = logging.getLogger("lydomania.battles")

battles_col = db["battles"]
battles_control_col = db["battles_control"]
cases_col = db["cases"]
items_col = db["items"]


class BattleError(Exception):
    """User-facing bet/seat error."""


# ────────────────────────────────────────────────────────────────────────
# Per-battle WS hub + global lobby hub
# ────────────────────────────────────────────────────────────────────────


class _BattleHub:
    """Channel-aware pub/sub. One channel per battle_id + one 'lobby' channel."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=128)
        self._subs.setdefault(channel, set()).add(q)
        return q

    def unsubscribe(self, channel: str, q: asyncio.Queue) -> None:
        s = self._subs.get(channel)
        if s:
            s.discard(q)
            if not s:
                self._subs.pop(channel, None)

    def broadcast(self, channel: str, msg: dict[str, Any]) -> None:
        for q in list(self._subs.get(channel, ())):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                self._subs[channel].discard(q)

    def subscribers(self, channel: str) -> int:
        return len(self._subs.get(channel, set()))


hub = _BattleHub()
_running_battles: dict[str, asyncio.Task] = {}


# ────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────


async def _get_rake_pct() -> float:
    doc = await battles_control_col.find_one({"id": "control"}, {"_id": 0, "rake_pct": 1})
    if doc and doc.get("rake_pct") is not None:
        return clamp_rake(float(doc["rake_pct"]))
    return HOUSE_RAKE_DEFAULT_PCT


async def _load_cases(case_slugs: list[str]) -> list[dict]:
    """Fetch each case in order. Raises BattleError if any case is missing."""
    cases: list[dict] = []
    for slug in case_slugs:
        doc = await cases_col.find_one(
            {"$or": [{"id": slug}, {"slug": slug}], "enabled": {"$ne": False}},
            {"_id": 0},
        )
        if not doc:
            raise BattleError(f"case not found: {slug}")
        if float(doc.get("price_ton") or 0) <= 0:
            raise BattleError(f"case has no price: {slug}")
        cases.append(doc)
    return cases


def _public_seat(seat: dict, include_rounds: bool = True) -> dict:
    out = {
        "seat_index": int(seat["seat_index"]),
        "user_id": seat.get("user_id"),
        "username": seat.get("username"),
        "telegram_id": seat.get("telegram_id"),
        "photo_url": seat.get("photo_url"),
        "joined_at": seat.get("joined_at"),
        "total_payout_ton": float(seat.get("total_payout_ton") or 0),
    }
    if include_rounds:
        out["rounds"] = seat.get("rounds", [])
    return out


def public_battle(doc: dict, full: bool = True) -> dict:
    return {
        "battle_id": doc["battle_id"],
        "creator_user_id": doc.get("creator_user_id"),
        "mode": doc["mode"],
        "players": int(doc["players"]),
        "case_sequence": list(doc.get("case_sequence", [])),
        "case_prices": list(doc.get("case_prices", [])),
        "entry_ton": float(doc.get("entry_ton") or 0),
        "pot_ton": float(doc.get("pot_ton") or 0),
        "house_rake_pct": float(doc.get("house_rake_pct") or 0),
        "status": doc["status"],
        "server_seed_hash": doc.get("server_seed_hash"),
        "server_seed_revealed": doc.get("server_seed_revealed"),
        "current_round_idx": int(doc.get("current_round_idx") or 0),
        "winner_seat_indices": list(doc.get("winner_seat_indices", [])),
        "payout_per_winner_ton": float(doc.get("payout_per_winner_ton") or 0),
        "seats": [_public_seat(s, include_rounds=full) for s in doc.get("seats", [])],
        "created_at": doc.get("created_at"),
        "started_at": doc.get("started_at"),
        "completed_at": doc.get("completed_at"),
        "ready_at": doc.get("ready_at"),
    }


def _filled_seat_count(seats: list[dict]) -> int:
    return sum(1 for s in seats if s.get("user_id"))


# ────────────────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────────────────


async def create_battle(
    user: dict, mode: str, players: int, case_sequence: list[str],
) -> dict:
    if not validate_mode(mode):
        raise BattleError("invalid mode")
    if not validate_players(players):
        raise BattleError("invalid players count")
    ok, err = validate_case_sequence(case_sequence)
    if not ok:
        raise BattleError(err or "invalid case sequence")

    cases = await _load_cases(case_sequence)
    case_prices = [float(c["price_ton"]) for c in cases]
    entry = compute_entry_ton(case_prices)
    pot = compute_pot_ton(entry, players)
    rake_pct = await _get_rake_pct()

    # 1) Atomic debit of creator's balance
    debited = await users_col.find_one_and_update(
        {"id": user["id"], "balance_ton": {"$gte": entry}},
        {"$inc": {"balance_ton": -entry}, "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "balance_ton": 1},
    )
    if not debited:
        raise BattleError("insufficient_balance")

    battle_id = secrets.token_hex(10)
    server_seed = secrets.token_hex(32)
    import hashlib
    seed_hash = hashlib.sha256(server_seed.encode()).hexdigest()

    seats: list[dict] = []
    for i in range(int(players)):
        seats.append({
            "seat_index": i,
            "user_id": user["id"] if i == 0 else None,
            "username": user.get("username") if i == 0 else None,
            "telegram_id": int(user.get("telegram_id") or 0) if i == 0 else None,
            "photo_url": user.get("photo_url") if i == 0 else None,
            "joined_at": iso(now()) if i == 0 else None,
            "rounds": [],
            "total_payout_ton": 0.0,
        })

    doc = {
        "battle_id": battle_id,
        "creator_user_id": user["id"],
        "mode": mode,
        "players": int(players),
        "case_sequence": list(case_sequence),
        "case_prices": case_prices,
        "entry_ton": entry,
        "pot_ton": pot,
        "house_rake_pct": rake_pct,
        "status": "open",
        "server_seed": server_seed,
        "server_seed_hash": seed_hash,
        "server_seed_revealed": None,
        "current_round_idx": 0,
        "winner_seat_indices": [],
        "payout_per_winner_ton": 0.0,
        "seats": seats,
        "created_at": iso(now()),
        "ready_at": None,
        "started_at": None,
        "completed_at": None,
    }
    await battles_col.insert_one(doc)
    pub = public_battle(doc, full=False)
    hub.broadcast("lobby", {"type": "battle_created", "battle": pub})
    return {**pub, "balance_ton": float(debited["balance_ton"])}


async def join_battle(user: dict, battle_id: str) -> dict:
    """Atomic seat claim. Race-safe via Mongo arrayFilters."""
    for _attempt in range(5):
        doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
        if not doc:
            raise BattleError("battle not found")
        if doc["status"] != "open":
            raise BattleError("battle is not open")
        if any(s.get("user_id") == user["id"] for s in doc["seats"]):
            raise BattleError("already_joined")
        empty_seat = next((s for s in doc["seats"] if s.get("user_id") is None), None)
        if not empty_seat:
            raise BattleError("battle_full")
        entry = float(doc["entry_ton"])
        seat_idx = empty_seat["seat_index"]

        # Try atomic seat claim BEFORE debit, so a lost race doesn't bill anyone.
        result = await battles_col.find_one_and_update(
            {"battle_id": battle_id, "status": "open"},
            {"$set": {
                "seats.$[s].user_id": user["id"],
                "seats.$[s].username": user.get("username"),
                "seats.$[s].telegram_id": int(user.get("telegram_id") or 0),
                "seats.$[s].photo_url": user.get("photo_url"),
                "seats.$[s].joined_at": iso(now()),
            }},
            array_filters=[{"s.seat_index": seat_idx, "s.user_id": None}],
            return_document=ReturnDocument.AFTER,
        )
        # Confirm WE got the seat (arrayFilters may match nothing → race lost)
        if not result or not any(
            s["seat_index"] == seat_idx and s.get("user_id") == user["id"]
            for s in result.get("seats", [])
        ):
            await asyncio.sleep(0.02 * (_attempt + 1))
            continue

        # Now debit
        debited = await users_col.find_one_and_update(
            {"id": user["id"], "balance_ton": {"$gte": entry}},
            {"$inc": {"balance_ton": -entry}, "$set": {"updated_at": iso(now())}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "balance_ton": 1},
        )
        if not debited:
            # Release seat
            await battles_col.update_one(
                {"battle_id": battle_id},
                {"$set": {
                    "seats.$[s].user_id": None,
                    "seats.$[s].username": None,
                    "seats.$[s].telegram_id": None,
                    "seats.$[s].photo_url": None,
                    "seats.$[s].joined_at": None,
                }},
                array_filters=[{"s.seat_index": seat_idx, "s.user_id": user["id"]}],
            )
            raise BattleError("insufficient_balance")

        # If now full → flip to ready + schedule runner
        filled = _filled_seat_count(result["seats"])
        ready = filled == int(result["players"])
        if ready:
            flipped = await battles_col.find_one_and_update(
                {"battle_id": battle_id, "status": "open"},
                {"$set": {"status": "ready", "ready_at": iso(now())}},
                return_document=ReturnDocument.AFTER,
            )
            if flipped:
                _schedule_match(battle_id)
                doc_for_pub = flipped
            else:
                doc_for_pub = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
        else:
            doc_for_pub = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})

        pub = public_battle(doc_for_pub, full=False)
        hub.broadcast("lobby", {"type": "battle_updated", "battle": pub})
        hub.broadcast(battle_id, {"type": "seat_joined",
                                  "seat_index": seat_idx,
                                  "battle": public_battle(doc_for_pub)})
        return {**pub, "balance_ton": float(debited["balance_ton"])}
    raise BattleError("seat_contention")


async def leave_battle(user: dict, battle_id: str) -> dict:
    """Leaving is only allowed when status=open. Refunds entry."""
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        raise BattleError("battle not found")
    if doc["status"] != "open":
        raise BattleError("battle already started")
    seat = next((s for s in doc["seats"] if s.get("user_id") == user["id"]), None)
    if not seat:
        raise BattleError("not_seated")
    entry = float(doc["entry_ton"])

    # Atomic release seat
    released = await battles_col.find_one_and_update(
        {"battle_id": battle_id, "status": "open"},
        {"$set": {
            "seats.$[s].user_id": None,
            "seats.$[s].username": None,
            "seats.$[s].telegram_id": None,
            "seats.$[s].photo_url": None,
            "seats.$[s].joined_at": None,
        }},
        array_filters=[{"s.seat_index": seat["seat_index"], "s.user_id": user["id"]}],
        return_document=ReturnDocument.AFTER,
    )
    if not released:
        raise BattleError("not_seated")

    # Refund
    credited = await users_col.find_one_and_update(
        {"id": user["id"]},
        {"$inc": {"balance_ton": entry}, "$set": {"updated_at": iso(now())}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "balance_ton": 1},
    )

    # If creator left and no other seats → cancel the battle
    creator_left = user["id"] == doc["creator_user_id"]
    others_present = any(s.get("user_id") for s in released["seats"])
    if creator_left and not others_present:
        await battles_col.update_one(
            {"battle_id": battle_id, "status": "open"},
            {"$set": {"status": "cancelled", "completed_at": iso(now())}},
        )
        cancelled = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
        hub.broadcast("lobby", {"type": "battle_cancelled", "battle": public_battle(cancelled, full=False)})
        hub.broadcast(battle_id, {"type": "cancelled", "battle": public_battle(cancelled)})
        return {**public_battle(cancelled, full=False), "balance_ton": float(credited["balance_ton"])}

    refreshed = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    hub.broadcast("lobby", {"type": "battle_updated", "battle": public_battle(refreshed, full=False)})
    hub.broadcast(battle_id, {"type": "seat_left", "seat_index": seat["seat_index"],
                              "battle": public_battle(refreshed)})
    return {**public_battle(refreshed, full=False), "balance_ton": float(credited["balance_ton"])}


# ────────────────────────────────────────────────────────────────────────
# Match runner
# ────────────────────────────────────────────────────────────────────────


def _schedule_match(battle_id: str) -> None:
    if battle_id in _running_battles and not _running_battles[battle_id].done():
        return
    _running_battles[battle_id] = asyncio.create_task(
        _run_match(battle_id), name=f"battle-{battle_id}",
    )


async def _run_match(battle_id: str) -> None:
    try:
        await _do_run(battle_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        LOG.exception("battle runner crashed · battle_id=%s", battle_id)
    finally:
        _running_battles.pop(battle_id, None)


async def _do_run(battle_id: str) -> None:
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc or doc["status"] not in ("ready", "rolling"):
        return

    # Reveal hash at lobby end (already in doc); broadcast ready event
    hub.broadcast(battle_id, {
        "type": "countdown",
        "countdown_sec": COUNTDOWN_SEC,
        "ready_at": doc.get("ready_at"),
    })
    await asyncio.sleep(COUNTDOWN_SEC)

    await battles_col.update_one(
        {"battle_id": battle_id, "status": "ready"},
        {"$set": {"status": "rolling", "started_at": iso(now())}},
    )
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc or doc["status"] != "rolling":
        return
    hub.broadcast(battle_id, {"type": "status", "status": "rolling"})
    hub.broadcast("lobby", {"type": "battle_updated",
                            "battle": public_battle(doc, full=False)})

    cases = await _load_cases(doc["case_sequence"])
    server_seed = doc["server_seed"]
    seats = doc["seats"]

    # Per-case rolling
    for round_idx, case in enumerate(cases):
        basket = case.get("basket", [])
        picks = []  # per-seat (slug, payout_ton, hmac_hex)
        for seat in seats:
            try:
                _, slug, payout, hex_h = derive_item_pick(
                    basket, server_seed, battle_id, round_idx, int(seat["seat_index"]),
                )
            except ValueError:
                slug, payout, hex_h = "", 0.0, ""
            picks.append({"seat_index": int(seat["seat_index"]),
                          "slug": slug, "payout_ton": payout, "hmac_hex": hex_h})

        # Persist round results onto each seat + update running totals
        for p in picks:
            await battles_col.update_one(
                {"battle_id": battle_id},
                {
                    "$push": {"seats.$[s].rounds": {
                        "round_idx": round_idx,
                        "case_slug": case.get("id"),
                        "item_slug": p["slug"],
                        "payout_ton": p["payout_ton"],
                        "hmac_hex": p["hmac_hex"],
                    }},
                    "$inc": {"seats.$[s].total_payout_ton": p["payout_ton"]},
                    "$set": {"current_round_idx": round_idx + 1},
                },
                array_filters=[{"s.seat_index": p["seat_index"]}],
            )

        # Fetch item meta for the reveal payload (small)
        item_meta: dict[str, dict] = {}
        slugs = {p["slug"] for p in picks if p["slug"]}
        if slugs:
            async for it in items_col.find(
                {"slug": {"$in": list(slugs)}},
                {"_id": 0, "slug": 1, "name": 1, "image_path": 1, "rarity": 1, "floor_price_ton": 1},
            ):
                item_meta[it["slug"]] = it

        hub.broadcast(battle_id, {
            "type": "round_reveal",
            "round_idx": round_idx,
            "case_slug": case.get("id"),
            "picks": [{
                **p,
                "item": item_meta.get(p["slug"]),
            } for p in picks],
            "reveal_duration_sec": ROUND_REVEAL_SEC,
        })
        await asyncio.sleep(ROUND_REVEAL_SEC)

    # Settle
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        return
    totals = [(int(s["seat_index"]), float(s.get("total_payout_ton") or 0))
              for s in doc["seats"]]
    winners = determine_winners(doc["mode"], totals)
    payout_pool = compute_payout_pool_ton(doc["pot_ton"], doc["house_rake_pct"])
    per_winner = split_payout(payout_pool, len(winners))

    # Credit each winner atomically
    for seat in doc["seats"]:
        if int(seat["seat_index"]) in winners and seat.get("user_id"):
            await users_col.update_one(
                {"id": seat["user_id"]},
                {"$inc": {"balance_ton": per_winner},
                 "$set": {"updated_at": iso(now())}},
            )
            # Phase 7c — +20 XP to each winner. Idempotent via "<battle_id>:<seat_idx>".
            try:
                from services.season import award_xp as _award_xp
                await _award_xp(
                    seat["user_id"], 20, "battle_win",
                    f"{battle_id}:{int(seat['seat_index'])}",
                )
            except Exception as _e:  # noqa: BLE001
                LOG.warning("battles: season XP hook failed battle_id=%s seat=%s: %s",
                            battle_id, seat["seat_index"], _e)

    await battles_col.update_one(
        {"battle_id": battle_id},
        {"$set": {
            "status": "completed",
            "completed_at": iso(now()),
            "server_seed_revealed": doc["server_seed"],
            "winner_seat_indices": winners,
            "payout_per_winner_ton": per_winner,
        }},
    )
    final_doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    hub.broadcast(battle_id, {
        "type": "completed",
        "winner_seat_indices": winners,
        "payout_per_winner_ton": per_winner,
        "server_seed": doc["server_seed"],
        "battle": public_battle(final_doc),
    })
    hub.broadcast("lobby", {"type": "battle_completed",
                            "battle": public_battle(final_doc, full=False)})


async def force_cancel(battle_id: str) -> dict:
    """Admin: emergency abort. Refund all seated players."""
    doc = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    if not doc:
        raise BattleError("battle not found")
    if doc["status"] in ("completed", "cancelled"):
        return public_battle(doc)
    entry = float(doc["entry_ton"])
    for seat in doc.get("seats", []):
        if seat.get("user_id"):
            await users_col.update_one(
                {"id": seat["user_id"]},
                {"$inc": {"balance_ton": entry},
                 "$set": {"updated_at": iso(now())}},
            )
    await battles_col.update_one(
        {"battle_id": battle_id},
        {"$set": {"status": "cancelled", "completed_at": iso(now())}},
    )
    cancelled = await battles_col.find_one({"battle_id": battle_id}, {"_id": 0})
    task = _running_battles.pop(battle_id, None)
    if task and not task.done():
        task.cancel()
    hub.broadcast(battle_id, {"type": "cancelled", "battle": public_battle(cancelled)})
    hub.broadcast("lobby", {"type": "battle_cancelled",
                            "battle": public_battle(cancelled, full=False)})
    return public_battle(cancelled)


async def on_startup() -> None:
    """Resume / cancel any battles caught mid-flight by a restart."""
    async for doc in battles_col.find(
        {"status": {"$in": ["ready", "rolling"]}}, {"_id": 0, "battle_id": 1, "status": 1},
    ):
        try:
            await force_cancel(doc["battle_id"])
            LOG.warning(
                "force-cancelled in-flight battle on boot: %s (was %s)",
                doc["battle_id"], doc["status"],
            )
        except Exception:  # noqa: BLE001
            LOG.exception("failed to clean up battle %s", doc["battle_id"])
