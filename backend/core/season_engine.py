"""Phase 7c — Battle Pass / Seasons engine.

Pure functions:
  • xp_for_tier(n)            → XP required to advance FROM tier (n-1) → tier n
                                Formula: 100 * n * (1 + 0.05 * n)
                                Tier 1 → 105, Tier 30 → 7,500
  • cumulative_xp_for_tier(n) → total XP needed to REACH tier n (sum of tiers 1..n)
  • tier_from_xp(xp)          → reverse lookup: current tier given total XP
  • default_tier_rewards()    → the 30-tier free/premium reward ladder template
  • REWARD_TYPES              → enum of reward types

Calibration: Curve sum at tier 25 ≈ 53,250 XP; tier 30 ≈ 91,500 XP.
An active player wagering ~1 TON case-equivalent per day (≈ 5 XP/case · 50 cases)
hits tier 25 in ~30 days. Tunable per-season via admin patch.
"""
from __future__ import annotations

from typing import Any, Final

TOTAL_TIERS: Final[int] = 30
SEASON_DURATION_DAYS: Final[int] = 30
PREMIUM_UNLOCK_TON: Final[float] = 50.0
DAILY_LOGIN_XP: Final[int] = 25
REFERRAL_FIRST_DEPOSIT_XP: Final[int] = 50

# XP multipliers per action source (used directly by the wiring code; centralised
# here so admins can later overlay per-season overrides).
XP_PER_TON_CASE_OPEN:    Final[float] = 5.0     # int(price_ton * 5) per open
XP_PER_TON_ROULETTE_WIN: Final[float] = 2.0     # int(amount * 2) on winning bets
XP_PER_BATTLE_WIN:       Final[int]   = 20
XP_PER_TON_CRASH_CASHOUT:Final[float] = 1.0     # int(amount * 1) if cashed_at_x > 1
XP_PER_WHEEL_SPIN:       Final[int]   = 10


def xp_for_tier(n: int) -> int:
    """XP required to advance from (n-1) into tier n. Integer."""
    if n < 1:
        return 0
    # 100 * n * (1 + 0.05 * n)  →  100n + 5n²
    return int(100 * n + 5 * n * n)


def cumulative_xp_for_tier(n: int) -> int:
    """Total XP required to REACH tier n (i.e. complete tier n)."""
    if n <= 0:
        return 0
    return sum(xp_for_tier(i) for i in range(1, n + 1))


def tier_from_xp(xp: int) -> int:
    """Reverse lookup. Returns 0 if user has less XP than tier-1 unlocks.
    Caps at TOTAL_TIERS once accrued."""
    if xp <= 0:
        return 0
    cum = 0
    for i in range(1, TOTAL_TIERS + 1):
        cum += xp_for_tier(i)
        if xp < cum:
            return i - 1
    return TOTAL_TIERS


def xp_progress_into_current_tier(xp: int) -> tuple[int, int, int]:
    """Returns (xp_into_current, xp_required_for_next, next_tier).

    next_tier is the tier the user is currently filling toward. Already at
    max → (0, 0, TOTAL_TIERS).
    """
    cur = tier_from_xp(xp)
    if cur >= TOTAL_TIERS:
        return (0, 0, TOTAL_TIERS)
    cum_done = cumulative_xp_for_tier(cur)
    next_tier = cur + 1
    needed = xp_for_tier(next_tier)
    into = xp - cum_done
    return (max(0, into), needed, next_tier)


# ─── Reward ladder template ──────────────────────────────────────────────────
# Each reward: {type, amount_ton?, item_slug?, count?}
#   type = "ton"          → grant amount_ton TON to balance
#   type = "item"         → grant 1× item_slug into inventory
#   type = "free_spin"    → grant `count` wheel free spin tokens
#
# Curve intent:
#   Tiers 1-10   (warm-up):       small TON tips + free spins
#   Tiers 11-20  (mid-season):    low/mid gifts, modest TON
#   Tiers 21-30  (climax):        high gifts (premium-only legendaries),
#                                  tier-30 free = legendary; premium = legendary + 100 TON

# Item slugs chosen from those known to exist in the items collection
# (matches segments already used by the wheel + roulette baskets).
def default_tier_rewards() -> list[dict[str, Any]]:
    """The 30-tier reward ladder used to seed a fresh season."""
    rows: list[dict[str, Any]] = []
    for tier in range(1, TOTAL_TIERS + 1):
        xp_req = cumulative_xp_for_tier(tier)
        free = _free_reward_for(tier)
        premium = _premium_reward_for(tier)
        rows.append({
            "tier": tier,
            "xp_required": xp_req,
            "free_rewards": [free] if free else [],
            "premium_rewards": [premium] if premium else [],
        })
    return rows


def _free_reward_for(tier: int) -> dict[str, Any] | None:
    """Free track reward. Lighter — designed so even non-premium players want to grind."""
    # Tier 1-3: small TON tips
    if tier == 1:  return {"type": "ton", "amount_ton": 0.5}
    if tier == 2:  return {"type": "free_spin", "count": 1}
    if tier == 3:  return {"type": "ton", "amount_ton": 1.0}
    # Tier 4-7: more TON + spins
    if tier == 4:  return {"type": "ton", "amount_ton": 1.5}
    if tier == 5:  return {"type": "item", "item_slug": "token_dust"}
    if tier == 6:  return {"type": "ton", "amount_ton": 2.0}
    if tier == 7:  return {"type": "free_spin", "count": 1}
    # Tier 8-12: mid TON
    if tier == 8:  return {"type": "ton", "amount_ton": 3.0}
    if tier == 9:  return {"type": "item", "item_slug": "coin_flip"}
    if tier == 10: return {"type": "ton", "amount_ton": 5.0}
    if tier == 11: return {"type": "free_spin", "count": 2}
    if tier == 12: return {"type": "ton", "amount_ton": 4.0}
    # Tier 13-17: low gifts + bigger TON
    if tier == 13: return {"type": "item", "item_slug": "lucky_ticket"}
    if tier == 14: return {"type": "ton", "amount_ton": 6.0}
    if tier == 15: return {"type": "item", "item_slug": "daily_jackpot"}
    if tier == 16: return {"type": "ton", "amount_ton": 8.0}
    if tier == 17: return {"type": "free_spin", "count": 2}
    # Tier 18-22: mid gifts
    if tier == 18: return {"type": "ton", "amount_ton": 10.0}
    if tier == 19: return {"type": "item", "item_slug": "lol_pop"}
    if tier == 20: return {"type": "ton", "amount_ton": 12.0}
    if tier == 21: return {"type": "item", "item_slug": "candy_cane"}
    if tier == 22: return {"type": "ton", "amount_ton": 15.0}
    # Tier 23-27: bigger TON + mid gifts
    if tier == 23: return {"type": "free_spin", "count": 3}
    if tier == 24: return {"type": "ton", "amount_ton": 20.0}
    if tier == 25: return {"type": "item", "item_slug": "top_hat"}
    if tier == 26: return {"type": "ton", "amount_ton": 25.0}
    if tier == 27: return {"type": "item", "item_slug": "flying_broom"}
    # Tier 28-30: high TON capstone + legendary at 30
    if tier == 28: return {"type": "ton", "amount_ton": 30.0}
    if tier == 29: return {"type": "ton", "amount_ton": 40.0}
    if tier == 30: return {"type": "item", "item_slug": "trapped_heart"}
    return None


def _premium_reward_for(tier: int) -> dict[str, Any] | None:
    """Premium track reward. Strictly better than the free reward at the same tier."""
    if tier == 1:  return {"type": "ton", "amount_ton": 2.0}
    if tier == 2:  return {"type": "free_spin", "count": 2}
    if tier == 3:  return {"type": "ton", "amount_ton": 3.0}
    if tier == 4:  return {"type": "item", "item_slug": "token_dust"}
    if tier == 5:  return {"type": "ton", "amount_ton": 5.0}
    if tier == 6:  return {"type": "item", "item_slug": "coin_flip"}
    if tier == 7:  return {"type": "ton", "amount_ton": 7.0}
    if tier == 8:  return {"type": "free_spin", "count": 3}
    if tier == 9:  return {"type": "ton", "amount_ton": 10.0}
    if tier == 10: return {"type": "item", "item_slug": "lucky_ticket"}
    if tier == 11: return {"type": "ton", "amount_ton": 12.0}
    if tier == 12: return {"type": "item", "item_slug": "daily_jackpot"}
    if tier == 13: return {"type": "ton", "amount_ton": 15.0}
    if tier == 14: return {"type": "item", "item_slug": "top_hat"}
    if tier == 15: return {"type": "ton", "amount_ton": 18.0}
    if tier == 16: return {"type": "item", "item_slug": "flying_broom"}
    if tier == 17: return {"type": "ton", "amount_ton": 20.0}
    if tier == 18: return {"type": "free_spin", "count": 4}
    if tier == 19: return {"type": "item", "item_slug": "trapped_heart"}
    if tier == 20: return {"type": "ton", "amount_ton": 30.0}
    if tier == 21: return {"type": "item", "item_slug": "electric_skull"}
    if tier == 22: return {"type": "ton", "amount_ton": 35.0}
    if tier == 23: return {"type": "item", "item_slug": "bonded_ring"}
    if tier == 24: return {"type": "ton", "amount_ton": 45.0}
    if tier == 25: return {"type": "item", "item_slug": "electric_skull"}
    if tier == 26: return {"type": "ton", "amount_ton": 55.0}
    if tier == 27: return {"type": "item", "item_slug": "bonded_ring"}
    if tier == 28: return {"type": "ton", "amount_ton": 70.0}
    if tier == 29: return {"type": "item", "item_slug": "heart_of_ton"}
    if tier == 30:
        # Climax — legendary + 100 TON
        return {"type": "ton", "amount_ton": 100.0}
    return None


def validate_track(track: str) -> bool:
    return track in ("free", "premium")


def validate_xp_source(source: str) -> bool:
    return source in (
        "case_open", "case_open_batch",
        "roulette_win",
        "battle_win",
        "crash_cashout",
        "wheel_spin",
        "daily_login",
        "referral_first_deposit",
        "admin_grant",  # for manual grants via admin (audited)
    )
