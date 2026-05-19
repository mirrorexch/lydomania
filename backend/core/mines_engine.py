"""Phase 8 — Mines engine (provably fair).

Standard Mines:
  • 5×5 grid (25 cells).
  • N mines placed at start using a server-seed-derived Fisher–Yates shuffle.
  • Player reveals cells one at a time. Hitting a mine ⇒ bust (lose bet).
  • Player can cashout at any time → payout = bet × current_multiplier.

Provably fair:
  • On `start`, server picks a server_seed, publishes server_seed_hash.
    `client_seed = game_id` (per-game nonce).
  • `derive_mines(server_seed, client_seed, mines_count)` deterministically
    places mines via Fisher–Yates over `[0..24]` using HMAC-SHA256 stream.
  • On bust OR cashout, server_seed is revealed; anyone reproduces the layout.

Multiplier curve (fair RTP ≈ 0.97):
  After revealing k safe cells out of (25 - mines):
      mult(k) = (prod_{i=0..k-1} 25-i / (25-mines-i)) × RTP
  This is the canonical inverse of "probability of getting k safe reveals".
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Final

GRID_SIZE: Final[int] = 25
MINES_MIN: Final[int] = 1
MINES_MAX: Final[int] = 24
RTP:       Final[float] = 0.97


class MinesError(Exception):
    """Surface as 400."""


def new_server_seed() -> str:
    return secrets.token_hex(32)


def hash_server_seed(server_seed: str) -> str:
    return hashlib.sha256(server_seed.encode("utf-8")).hexdigest()


def derive_mines(server_seed: str, client_seed: str, mines_count: int) -> set[int]:
    """Deterministic mine placement via HMAC-driven Fisher–Yates.

    Returns the SET of cell indices (0..24) containing mines.
    """
    if mines_count < MINES_MIN or mines_count > MINES_MAX:
        raise MinesError(f"invalid_mines_count:{mines_count}")
    deck = list(range(GRID_SIZE))
    counter = 0
    pos = 0
    # We need to draw (mines_count) random indices via Fisher–Yates.
    # Each random draw needs ~5 bits (since deck size ≤ 25). We pull 2 bytes
    # per draw to bias-correct via rejection sampling.
    digest = b""
    def next_uint16() -> int:
        nonlocal digest, pos, counter
        if pos + 2 > len(digest):
            msg = f"{client_seed}:mines:{counter}".encode("utf-8")
            digest = hmac.new(server_seed.encode("utf-8"), msg, hashlib.sha256).digest()
            pos = 0
            counter += 1
        v = (digest[pos] << 8) | digest[pos + 1]
        pos += 2
        return v

    for i in range(mines_count):
        # Draw j in [i, len(deck)-1] uniformly via rejection-sampled mod
        remaining = len(deck) - i
        # 65536 / remaining * remaining ≤ 65536; reject above this bound
        bound = (65536 // remaining) * remaining
        while True:
            r = next_uint16()
            if r < bound:
                j = i + (r % remaining)
                break
        deck[i], deck[j] = deck[j], deck[i]
    return set(deck[:mines_count])


def multiplier_for(mines_count: int, revealed_count: int) -> float:
    """Multiplier after `revealed_count` safe cells revealed."""
    if revealed_count < 0:
        return 1.0
    safe_total = GRID_SIZE - mines_count
    if revealed_count > safe_total:
        raise MinesError("too_many_reveals")
    # Probability of `revealed_count` consecutive safe reveals (no replacement):
    #   p = product_{i=0..revealed_count-1} (safe_total - i) / (GRID_SIZE - i)
    # Fair multiplier = 1/p × RTP
    if revealed_count == 0:
        return 1.0
    p = 1.0
    for i in range(revealed_count):
        p *= (safe_total - i) / (GRID_SIZE - i)
    return round(RTP / p, 4) if p > 0 else 0.0


def verify_layout(
    server_seed: str,
    server_seed_hash: str,
    client_seed: str,
    mines_count: int,
    mines_claim: list[int],
) -> dict:
    """Recompute the mine layout and verify it matches the claim."""
    hash_ok = hashlib.sha256(server_seed.encode("utf-8")).hexdigest() == server_seed_hash
    recomputed = derive_mines(server_seed, client_seed, mines_count)
    layout_ok = set(int(x) for x in mines_claim) == recomputed
    return {
        "server_seed_hash_matches": hash_ok,
        "layout_matches":           layout_ok,
        "recomputed_mines":         sorted(recomputed),
    }
