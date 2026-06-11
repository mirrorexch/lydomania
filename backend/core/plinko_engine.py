"""Phase 8 — Plinko engine (provably fair).

Commit-reveal (HMAC-SHA256) matching the Wheel/Crash pattern:
  1. On bet, server generates a fresh server_seed and publishes `server_seed_hash`.
  2. The (server_seed, client_seed=bet_id, nonce=0) tuple is HMAC'd to produce
     a deterministic stream of bits → the L/R direction of the ball at each row.
  3. After settlement, server_seed is revealed. Anyone can recompute the path.

Multiplier tables (rows × risk × bucket). Calibrated empirically so each
(rows, risk) yields RTP ≈ 0.96–0.98. Tables are symmetric around the centre
bucket and read as low-multiplier centre + high-multiplier edges, which is
the canonical Plinko payout shape (the edges are rare → big multipliers).

Math: distribution of `sum of right-bits` over n fair Bernoulli(0.5) rolls is
Binomial(n, 0.5). Bucket k has probability C(n,k) / 2^n.
RTP = Σ_k (C(n,k)/2^n) × multiplier[k].
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Final

ROWS_ALLOWED:   Final[tuple[int, ...]] = (8, 12, 16)
RISKS_ALLOWED:  Final[tuple[str, ...]] = ("low", "medium", "high")


# Target Return-To-Player for every (rows, risk) table — platform-wide 90-92% band.
TARGET_RTP: Final[float] = 0.91

# RAW multiplier shapes (bucket 0 = leftmost … n = rightmost). These encode the
# *shape* of each payout curve; absolute scale is normalised below so every table
# lands at exactly TARGET_RTP under fair Binomial(n, 0.5). Symmetric by design.
_RAW_MULTIPLIERS: Final[dict[tuple[int, str], list[float]]] = {
    # 8 rows → 9 buckets
    (8, "low"):    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    (8, "medium"): [10.0, 2.4, 1.2, 1.0, 0.2, 1.0, 1.2, 2.4, 10.0],
    (8, "high"):   [21.0, 3.3, 1.4, 0.5, 0.2, 0.5, 1.4, 3.3, 21.0],
    # 12 rows → 13 buckets
    (12, "low"):    [10.0, 3.0, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3.0, 10.0],
    (12, "medium"): [25.0, 9.0, 3.0, 1.5, 1.0, 0.9, 0.3, 0.9, 1.0, 1.5, 3.0, 9.0, 25.0],
    (12, "high"):   [130.0, 18.0, 6.0, 1.7, 0.8, 0.5, 0.2, 0.5, 0.8, 1.7, 6.0, 18.0, 130.0],
    # 16 rows → 17 buckets
    (16, "low"):    [16.0, 9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16.0],
    (16, "medium"): [110.0, 41.0, 10.0, 5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10.0, 41.0, 110.0],
    (16, "high"):   [1000.0, 130.0, 26.0, 9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26.0, 130.0, 1000.0],
}


def _normalize_to_target(table: list[float], rows: int) -> list[float]:
    """Scale a shape table so ΣP(k)·m[k] == TARGET_RTP under Binomial(rows, 0.5).

    Uniform scaling preserves the payout shape and symmetry exactly while moving
    the RTP to the target. Rounded to 4 d.p. (RTP drift < 1e-4).
    """
    from math import comb
    denom = float(1 << rows)
    rtp = sum((comb(rows, k) / denom) * table[k] for k in range(rows + 1))
    factor = TARGET_RTP / rtp
    return [round(m * factor, 4) for m in table]


# Normalised tables actually used at runtime — every one calibrated to TARGET_RTP.
MULTIPLIERS: Final[dict[tuple[int, str], list[float]]] = {
    key: _normalize_to_target(tbl, key[0]) for key, tbl in _RAW_MULTIPLIERS.items()
}


class PlinkoError(Exception):
    """Surface as 400."""


def is_valid_combination(rows: int, risk: str) -> bool:
    return rows in ROWS_ALLOWED and risk in RISKS_ALLOWED


def new_server_seed() -> str:
    """Cryptographically random server seed."""
    return secrets.token_hex(32)


def hash_server_seed(server_seed: str) -> str:
    """The publicly-committed hash that goes out PRE-drop."""
    return hashlib.sha256(server_seed.encode("utf-8")).hexdigest()


def derive_path(server_seed: str, client_seed: str, rows: int, nonce: int = 0) -> list[int]:
    """Deterministic L/R bit sequence for the ball drop.

    Returns a list of `rows` bits where 0 = left, 1 = right.
    The HMAC stream is consumed bit-by-bit; we re-key with a counter every
    256 bits so this works for any `rows` value (cap at 16 in practice).
    """
    if rows < 1:
        return []
    out: list[int] = []
    counter = 0
    while len(out) < rows:
        msg = f"{client_seed}:{nonce}:{counter}".encode("utf-8")
        digest = hmac.new(server_seed.encode("utf-8"), msg, hashlib.sha256).digest()
        # 32 bytes = 256 bits per HMAC; bit-stream MSB-first
        for byte in digest:
            for i in range(7, -1, -1):
                if len(out) >= rows:
                    break
                out.append((byte >> i) & 1)
            if len(out) >= rows:
                break
        counter += 1
    return out[:rows]


def final_bucket(path: list[int]) -> int:
    """Bucket index = sum of right-bits. Range 0..rows."""
    return sum(int(b) for b in path)


def get_multiplier(rows: int, risk: str, bucket: int) -> float:
    if not is_valid_combination(rows, risk):
        raise PlinkoError(f"invalid_combination:{rows}:{risk}")
    table = MULTIPLIERS[(rows, risk)]
    if bucket < 0 or bucket >= len(table):
        raise PlinkoError(f"invalid_bucket:{bucket}")
    return float(table[bucket])


def expected_rtp(rows: int, risk: str) -> float:
    """Analytical RTP under fair Binomial(rows, 0.5). Useful for tests."""
    from math import comb
    n = rows
    table = MULTIPLIERS[(rows, risk)]
    total = 0.0
    denom = float(1 << n)  # 2^n
    for k in range(n + 1):
        total += (comb(n, k) / denom) * table[k]
    return total


def verify_drop(
    server_seed: str,
    server_seed_hash: str,
    client_seed: str,
    rows: int,
    risk: str,
    bucket_claim: int,
    multiplier_claim: float,
    nonce: int = 0,
) -> dict:
    """Recompute everything and report match/mismatch booleans."""
    hash_ok = hashlib.sha256(server_seed.encode("utf-8")).hexdigest() == server_seed_hash
    path = derive_path(server_seed, client_seed, rows, nonce)
    bucket_re = final_bucket(path)
    bucket_ok = bucket_re == bucket_claim
    mult_re = get_multiplier(rows, risk, bucket_re)
    mult_ok = abs(mult_re - float(multiplier_claim)) < 1e-9
    return {
        "server_seed_hash_matches": hash_ok,
        "bucket_matches":           bucket_ok,
        "multiplier_matches":       mult_ok,
        "recomputed_path":          path,
        "recomputed_bucket":        bucket_re,
        "recomputed_multiplier":    mult_re,
    }
