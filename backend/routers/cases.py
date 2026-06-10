"""Cases routes: /cases, /cases/{id}, /cases/{id}/open, /cases/{id}/open-batch."""
from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

import game
from core.auth import get_current_user
from core.config import BATCH_OPEN_MAX, ROTATE_NONCE_EVERY, logger
from core.image_urls import case_image_url, item_image_url
from core.db import (    cases_col, inventory_col, items_col, ref_credits_col, rolls_col, users_col,
)
from core.models import (
    CaseBasketEntryOut, CaseDetailOut, CaseOpenBatchIn, CaseOpenBatchOut,
    CaseOpenIn, CaseOpenOut, CaseSummaryOut, BatchRollOut, WonItemOut,
)
from core.time_utils import iso, now
from core.ton import static_url
from routers.fair import get_or_create_fair_state, rotate_fair_state
from services.notifications import enqueue_t
from services.referral_ladder import tier_pct_for_user_count

router = APIRouter(prefix="/api")

BIG_WIN_MULTIPLIER_THRESHOLD = 5.0
DAILY_FREE_DEFAULT_COOLDOWN_S = 24 * 3600


def _is_daily_free(case: dict) -> bool:
    return bool(case.get("is_daily_free") or False)


def _free_case_cooldown_remaining_s(user: dict, case: dict) -> int:
    """Seconds remaining on this user's free-spin cooldown for `case`. 0 if available."""
    cd = int(case.get("free_spin_cooldown_seconds") or DAILY_FREE_DEFAULT_COOLDOWN_S)
    last = user.get("last_free_spin_at")
    if not last:
        return 0
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if isinstance(last, str) else last
        elapsed = (now() - dt).total_seconds()
        remaining = cd - int(elapsed)
        return max(0, remaining)
    except Exception:
        return 0


async def _maybe_enqueue_big_win_dm(
    user: dict, case: dict, item_meta: dict, payout_ton: float, roll_id: str,
) -> None:
    """If multiplier ≥ threshold, queue a Telegram DM celebrating the win."""
    price = float(case.get("price_ton") or 0)
    if price <= 0 or payout_ton <= 0:
        return
    mult = payout_ton / price
    if mult < BIG_WIN_MULTIPLIER_THRESHOLD:
        return
    tg = user.get("telegram_id")
    if not tg:
        return
    name = item_meta.get("name") or "your gift"
    case_name = case.get("name") or case.get("id")
    try:
        await enqueue_t(
            int(tg),
            "big_win",
            kind="big_win",
            item=name,
            payout=payout_ton,
            mult=mult,
            case=case_name,
        )
    except Exception as e:
        logger.warning("big_win DM enqueue failed (user=%s, roll=%s): %s", user.get("id"), roll_id, e)


async def _load_items_by_slug(slugs: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not slugs:
        return out
    cur = items_col.find({"slug": {"$in": slugs}}, {"_id": 0})
    async for d in cur:
        out[d["slug"]] = d
    return out


def _compute_actual_ev(basket: list[dict]) -> float:
    total = sum(float(b.get("weight", 0)) for b in basket)
    if total <= 0:
        return 0.0
    ev = sum(float(b["payout_ton"]) * float(b["weight"]) / total for b in basket)
    return ev


def _build_basket_entries(case_doc: dict, items_meta: dict[str, dict]) -> list[CaseBasketEntryOut]:
    basket = case_doc.get("basket", [])
    total_w = sum(float(b.get("weight", 0)) for b in basket) or 1.0
    out: list[CaseBasketEntryOut] = []
    for b in basket:
        slug = b["slug"]
        m = items_meta.get(slug, {})
        out.append(CaseBasketEntryOut(
            slug=slug, name=m.get("name", slug), rarity=m.get("rarity", "common"),
            image_url=item_image_url(m),
            weight=float(b.get("weight", 0)),
            payout_ton=float(b.get("payout_ton", 0)),
            probability=float(b.get("weight", 0)) / total_w,
        ))
    return out


def _category_for(case: dict) -> str:
    """Phase 6b — derive category from explicit field, or infer from price."""
    cat = (case.get("category") or "").strip().lower()
    if cat in {"free", "low", "middle", "high"}:
        return cat
    if case.get("is_daily_free"):
        return "free"
    price = float(case.get("price_ton") or 0)
    if price <= 0:
        return "free"
    if price <= 25:
        return "low"
    if price <= 100:
        return "middle"
    return "high"


# Phase 11.2.5 — _case_image_url and _item_image_url were moved to
# core/image_urls.py so routers/wheel.py can share the same fallback chain
# and prevent the missing-icons regression there.  See:
#     from core.image_urls import case_image_url, item_image_url


async def _case_to_summary(c: dict) -> CaseSummaryOut:
    basket = c.get("basket", [])
    ev = _compute_actual_ev(basket)
    return CaseSummaryOut(
        id=c["id"], name=c["name"], slug=c.get("slug", c["id"]),
        price_ton=float(c["price_ton"]),
        image_url=case_image_url(c),
        actual_ev_pct=round((ev / float(c["price_ton"])) * 100, 2) if c["price_ton"] else 0.0,
        house_edge_pct=round((1 - ev / float(c["price_ton"])) * 100, 2) if c["price_ton"] else 0.0,
        enabled=bool(c.get("enabled", True)),
        item_count=len(basket),
        category=_category_for(c),
    )


@router.get("/cases", response_model=list[CaseSummaryOut])
async def list_cases() -> list[CaseSummaryOut]:
    cur = cases_col.find({"enabled": True}, {"_id": 0}).sort("price_ton", 1)
    out: list[CaseSummaryOut] = []
    async for c in cur:
        out.append(await _case_to_summary(c))
    return out


# IMPORTANT: must come BEFORE /cases/{case_id} so 'free_case/cooldown' isn't matched as case_id.
@router.get("/cases/free_case/cooldown")
async def free_case_cooldown(user: dict = Depends(get_current_user)) -> dict:
    case = await cases_col.find_one({"id": "free_case", "enabled": True}, {"_id": 0})
    if not case or not _is_daily_free(case):
        raise HTTPException(status_code=404, detail="daily free case not configured")
    fresh_user = await users_col.find_one({"id": user["id"]}, {"_id": 0}) or user
    remaining = _free_case_cooldown_remaining_s(fresh_user, case)
    next_at = None
    if remaining > 0:
        from datetime import timedelta
        next_at = iso(now() + timedelta(seconds=remaining))
    return {
        "case_id": "free_case",
        "available": remaining <= 0,
        "seconds_remaining": remaining,
        "next_available_at": next_at,
        "free_spin_tokens": int(fresh_user.get("free_spin_tokens") or 0),
    }


@router.get("/cases/{case_id}", response_model=CaseDetailOut)
async def case_detail(case_id: str) -> CaseDetailOut:
    c = await cases_col.find_one({"id": case_id, "enabled": True}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="case not found")
    items_meta = await _load_items_by_slug([b["slug"] for b in c.get("basket", [])])
    entries = _build_basket_entries(c, items_meta)
    summary = await _case_to_summary(c)
    return CaseDetailOut(**summary.model_dump(), items=entries, basket=entries)


@router.post("/cases/{case_id}/open", response_model=CaseOpenOut)
async def open_case(case_id: str, payload: CaseOpenIn, user: dict = Depends(get_current_user)) -> CaseOpenOut:
    case = await cases_col.find_one({"id": case_id, "enabled": True}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    price = float(case["price_ton"])
    used_free_spin_token = False
    # ---- Phase 4b · daily-free-case path ----
    if _is_daily_free(case):
        fresh_user = await users_col.find_one({"id": user["id"]}, {"_id": 0}) or user
        remaining = _free_case_cooldown_remaining_s(fresh_user, case)
        tokens = int(fresh_user.get("free_spin_tokens") or 0)
        if remaining > 0 and tokens <= 0:
            raise HTTPException(
                status_code=429,
                detail=f"free spin on cooldown · {remaining}s remaining (or redeem a free_spin_token promo)",
            )
        if remaining > 0 and tokens > 0:
            upd = await users_col.find_one_and_update(
                {"id": user["id"], "free_spin_tokens": {"$gte": 1}},
                {"$inc": {"free_spin_tokens": -1},
                 "$set": {"last_free_spin_at": iso(now()), "updated_at": iso(now())}},
                return_document=True, projection={"_id": 0},
            )
            if not upd:
                raise HTTPException(status_code=429, detail="no free spin tokens left")
            used_free_spin_token = True
        else:
            upd = await users_col.find_one_and_update(
                {"id": user["id"]},
                {"$set": {"last_free_spin_at": iso(now()), "updated_at": iso(now())}},
                return_document=True, projection={"_id": 0},
            )
    else:
        upd = await users_col.find_one_and_update(
            {"id": user["id"], "balance_ton": {"$gte": price}},
            {"$inc": {"balance_ton": -price}, "$set": {"updated_at": iso(now())}},
            return_document=True, projection={"_id": 0},
        )
        if not upd:
            raise HTTPException(status_code=402, detail="insufficient balance")
    state = await get_or_create_fair_state(user["id"])
    fair_after = await fair_col_inc(user["id"])
    nonce_used = int(fair_after["nonce"])
    server_seed = state["server_seed"]
    server_seed_hash = state["server_seed_hash"]
    client_seed = (payload.client_seed or "").strip() or game.gen_client_seed()
    roll_hash, roll_float = game.compute_roll(server_seed, client_seed, nonce_used)
    basket = case.get("basket", [])
    winner = game.pick_winner(roll_float, basket)
    winning_slug = winner["slug"]
    payout_ton = float(winner["payout_ton"])
    items_meta = await _load_items_by_slug([winning_slug])
    item_meta = items_meta.get(winning_slug) or {
        "name": winning_slug, "rarity": "common",
        "image_path": "items/crate_common.png",
    }
    roll_id = secrets.token_hex(12)
    inv_id = secrets.token_hex(12)
    now_iso = iso(now())
    await rolls_col.insert_one({
        "id": roll_id, "user_id": user["id"], "case_id": case["id"],
        "server_seed_hash": server_seed_hash, "server_seed": server_seed,
        "client_seed": client_seed, "nonce": nonce_used,
        "roll_hash": roll_hash, "roll_float": float(roll_float),
        "winning_item_slug": winning_slug, "payout_ton": payout_ton,
        "case_price_ton": float(price),  # Phase 4b — needed by leaderboard wagered aggregate
        "created_at": now_iso,
    })
    await inventory_col.insert_one({
        "id": inv_id, "user_id": user["id"], "case_id": case["id"], "roll_id": roll_id,
        "item_slug": winning_slug, "item_name": item_meta.get("name", winning_slug),
        "rarity": item_meta.get("rarity", "common"),
        "image_path": item_meta.get("image_path", "items/crate_common.png"),
        "payout_ton": payout_ton, "status": "in_inventory", "created_at": now_iso,
    })
    if user.get("referred_by_user_id"):
        await _credit_referrer(user["referred_by_user_id"], user["id"], case["id"], price, roll_id)
    if nonce_used >= ROTATE_NONCE_EVERY:
        await rotate_fair_state(user["id"])
    await _maybe_enqueue_big_win_dm(user, case, item_meta, payout_ton, roll_id)
    # Phase 7c — Battle Pass XP. +5 XP per TON spent on a case (paid only).
    # Free daily case has price=0 → no XP. Idempotent via roll_id.
    if price > 0:
        try:
            from services.season import award_xp as _award_xp
            await _award_xp(user["id"], int(price * 5), "case_open", roll_id)
        except Exception as _e:  # noqa: BLE001
            logger.warning("cases: season XP hook failed roll_id=%s: %s", roll_id, _e)
    return CaseOpenOut(
        roll_id=roll_id, inventory_id=inv_id,
        winning_item=WonItemOut(
            slug=winning_slug, name=item_meta.get("name", winning_slug),
            rarity=item_meta.get("rarity", "common"),
            image_url=item_image_url(item_meta),
            payout_ton=payout_ton,
        ),
        payout_ton=payout_ton,
        # SECURITY: do NOT reveal the still-active server seed. Disclosing it before
        # rotation lets a player predict future rolls and farm jackpots. The retired
        # seed is disclosed via /fair/rotate after rotation. UI does not consume this.
        server_seed_hash=server_seed_hash, server_seed_revealed="",
        client_seed=client_seed, nonce=nonce_used, roll_float=float(roll_float),
        new_balance=float(upd["balance_ton"]),
    )


async def fair_col_inc(user_id: str) -> dict:
    from core.db import fair_col
    return await fair_col.find_one_and_update(
        {"user_id": user_id}, {"$inc": {"nonce": 1}},
        return_document=True, projection={"_id": 0},
    )


async def _credit_referrer(
    referrer_id: str, referee_id: str, case_id: str, wagered: float,
    roll_id: str | None = None, batch_count: int | None = None,
) -> None:
    """Phase 3a: tier-aware ladder rate."""
    count = await users_col.count_documents({"referred_by_user_id": referrer_id})
    pct = await tier_pct_for_user_count(count)
    amount = round(wagered * pct, 9)
    if amount <= 0:
        return
    await users_col.update_one({"id": referrer_id}, {"$inc": {"referral_balance": amount}})
    await ref_credits_col.insert_one({
        "id": secrets.token_hex(12),
        "referrer_user_id": referrer_id, "referee_user_id": referee_id,
        "source_roll_id": roll_id, "source_case_id": case_id,
        "wagered_ton": wagered, "amount_ton": amount,
        "applied_pct": pct * 100.0,  # auditable
        "batch_count": batch_count,
        "created_at": iso(now()),
    })


@router.post("/cases/{case_id}/open-batch", response_model=CaseOpenBatchOut)
async def open_case_batch(
    case_id: str, payload: CaseOpenBatchIn, user: dict = Depends(get_current_user),
) -> CaseOpenBatchOut:
    case = await cases_col.find_one({"id": case_id, "enabled": True}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    if _is_daily_free(case):
        raise HTTPException(status_code=400, detail="daily free case can only be opened one at a time")
    price = float(case["price_ton"])
    count = int(payload.count)
    if count > BATCH_OPEN_MAX:
        raise HTTPException(status_code=400, detail=f"max batch is {BATCH_OPEN_MAX}")
    total_cost = round(price * count, 9)
    upd = await users_col.find_one_and_update(
        {"id": user["id"], "balance_ton": {"$gte": total_cost}},
        {"$inc": {"balance_ton": -total_cost}, "$set": {"updated_at": iso(now())}},
        return_document=True, projection={"_id": 0},
    )
    if not upd:
        raise HTTPException(status_code=402, detail="insufficient balance")
    state = await get_or_create_fair_state(user["id"])
    from core.db import fair_col
    fair_after = await fair_col.find_one_and_update(
        {"user_id": user["id"]}, {"$inc": {"nonce": count}},
        return_document=True, projection={"_id": 0},
    )
    new_nonce = int(fair_after["nonce"])
    server_seed = state["server_seed"]
    server_seed_hash = state["server_seed_hash"]
    client_seed = (payload.client_seed or "").strip() or game.gen_client_seed()
    basket = case.get("basket", [])
    items_meta = await _load_items_by_slug([b["slug"] for b in basket])
    rolls_out: list[BatchRollOut] = []
    total_won = 0.0
    now_iso = iso(now())
    for i in range(count):
        nonce_used = new_nonce - count + 1 + i
        roll_hash, roll_float = game.compute_roll(server_seed, client_seed, nonce_used)
        winner = game.pick_winner(roll_float, basket)
        payout_ton = float(winner["payout_ton"])
        winning_slug = winner["slug"]
        item_meta = items_meta.get(winning_slug) or {
            "name": winning_slug, "rarity": "common",
            "image_path": "items/crate_common.png",
        }
        roll_id = secrets.token_hex(12)
        inventory_id = secrets.token_hex(12)
        await rolls_col.insert_one({
            "id": roll_id, "user_id": user["id"], "case_id": case["id"],
            "server_seed_hash": server_seed_hash, "server_seed": server_seed,
            "client_seed": client_seed, "nonce": nonce_used,
            "roll_hash": roll_hash, "roll_float": float(roll_float),
            "winning_item_slug": winning_slug, "payout_ton": payout_ton,
            "batch": True, "created_at": now_iso,
        })
        await inventory_col.insert_one({
            "id": inventory_id, "user_id": user["id"], "case_id": case["id"], "roll_id": roll_id,
            "item_slug": winning_slug, "item_name": item_meta.get("name", winning_slug),
            "rarity": item_meta.get("rarity", "common"),
            "image_path": item_meta.get("image_path", "items/crate_common.png"),
            "payout_ton": payout_ton, "status": "in_inventory", "created_at": now_iso,
        })
        rolls_out.append(BatchRollOut(
            roll_id=roll_id, inventory_id=inventory_id,
            winning_item=WonItemOut(
                slug=winning_slug, name=item_meta.get("name", winning_slug),
                rarity=item_meta.get("rarity", "common"),
                image_url=item_image_url(item_meta),
                payout_ton=payout_ton,
            ),
            payout_ton=payout_ton, nonce=nonce_used, roll_float=float(roll_float),
        ))
        total_won += payout_ton
        await _maybe_enqueue_big_win_dm(user, case, item_meta, payout_ton, roll_id)
        # Phase 7c — XP per single roll within the batch, idempotent via roll_id
        if price > 0:
            try:
                from services.season import award_xp as _award_xp
                await _award_xp(user["id"], int(price * 5), "case_open_batch", roll_id)
            except Exception as _e:  # noqa: BLE001
                logger.warning("cases-batch: season XP hook failed roll_id=%s: %s", roll_id, _e)
    if user.get("referred_by_user_id"):
        await _credit_referrer(user["referred_by_user_id"], user["id"], case["id"], total_cost, batch_count=count)
    if new_nonce >= ROTATE_NONCE_EVERY:
        await rotate_fair_state(user["id"])
    return CaseOpenBatchOut(
        rolls=rolls_out, server_seed_hash=server_seed_hash,
        # SECURITY: never reveal the active server seed (see single-open path above).
        server_seed_revealed="", client_seed=client_seed,
        total_paid_ton=total_cost, total_won_ton=round(total_won, 9),
        net_pnl_ton=round(total_won - total_cost, 9),
        new_balance=float(upd["balance_ton"]),
    )
