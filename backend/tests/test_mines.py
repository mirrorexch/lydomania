"""Phase 8 — Mines tests."""
from __future__ import annotations

import secrets

import pytest

from core.db import users_col
from core.mines_engine import (
    GRID_SIZE, MinesError, derive_mines, hash_server_seed, multiplier_for,
    new_server_seed, verify_layout,
)
from core.time_utils import iso, now
from services.mines import cashout, reveal_cell, start_game


def test_derive_mines_deterministic_and_correct_size():
    a = derive_mines("seed1", "client1", 5)
    b = derive_mines("seed1", "client1", 5)
    assert a == b
    assert len(a) == 5
    assert all(0 <= x < GRID_SIZE for x in a)


def test_derive_mines_different_inputs_differ():
    a = derive_mines("seed1", "client1", 5)
    b = derive_mines("seed2", "client1", 5)
    assert a != b


def test_multiplier_grows_with_reveals():
    prev = 1.0
    for k in range(1, 20):
        m = multiplier_for(5, k)
        assert m >= prev, (k, m, prev)
        prev = m


def test_multiplier_rejects_overreveal():
    with pytest.raises(MinesError):
        multiplier_for(3, 25)


def test_verify_layout_recomputes():
    seed = new_server_seed()
    sh = hash_server_seed(seed)
    mines = derive_mines(seed, "client", 4)
    v = verify_layout(seed, sh, "client", 4, list(mines))
    assert v["server_seed_hash_matches"]
    assert v["layout_matches"]


def test_verify_layout_catches_tampering():
    seed = new_server_seed()
    sh = hash_server_seed(seed)
    mines = derive_mines(seed, "client", 4)
    tampered = list(mines)
    tampered[0] = (tampered[0] + 1) % GRID_SIZE
    v = verify_layout(seed, sh, "client", 4, tampered)
    assert v["layout_matches"] is False


# ── Service tests ──────────────────────────────────────────────────────────
async def _user(balance: float = 100.0):
    uid = secrets.token_hex(12)
    tid = secrets.randbelow(10_000_000_000) + 90_000_000_000
    await users_col.insert_one({
        "id": uid, "telegram_id": tid, "username": f"m{tid}",
        "balance_ton": float(balance),
        "created_at": iso(now()), "updated_at": iso(now()),
    })
    return uid


@pytest.mark.asyncio
async def test_start_debits_balance():
    uid = await _user(balance=10.0)
    g = await start_game(uid, 1.0, 3)
    assert g["bet_ton"] == 1.0
    assert abs(g["new_balance_ton"] - 9.0) < 1e-6


@pytest.mark.asyncio
async def test_reveal_safe_then_cashout():
    uid = await _user(balance=10.0)
    g = await start_game(uid, 1.0, 1)  # only 1 mine → safe cells likely
    # Find a safe cell — try cell 0, 1, 2... bust handler
    safe_cell = None
    for c in range(GRID_SIZE):
        r = await reveal_cell(uid, g["game_id"], c)
        if r.get("hit_mine"):
            # bust — start a fresh game
            g = await start_game(uid, 1.0, 1)
            continue
        safe_cell = c
        break
    assert safe_cell is not None
    res = await cashout(uid, g["game_id"])
    assert res["payout_ton"] > 1.0
    assert "server_seed" in res
    assert "mines" in res


@pytest.mark.asyncio
async def test_cashout_with_no_reveals_400():
    uid = await _user(balance=10.0)
    g = await start_game(uid, 1.0, 3)
    with pytest.raises(MinesError) as ei:
        await cashout(uid, g["game_id"])
    assert "nothing_to_cashout" in str(ei.value)


@pytest.mark.asyncio
async def test_double_reveal_same_cell_400():
    uid = await _user(balance=10.0)
    g = await start_game(uid, 1.0, 1)
    # Reveal cell 0
    r1 = await reveal_cell(uid, g["game_id"], 0)
    if r1.get("hit_mine"):
        return  # bust — skip
    with pytest.raises(MinesError) as ei:
        await reveal_cell(uid, g["game_id"], 0)
    assert "already_revealed" in str(ei.value)
