"""3-tier referral ladder (Phase 3a)."""
from __future__ import annotations

from typing import Optional

from services.settings import get_settings


async def tier_for_count(count: int) -> tuple[str, float, Optional[str], Optional[int]]:
    """
    Returns: (tier_name, pct, next_tier_name, next_tier_threshold)
    Tiers driven by app_settings.
    """
    s = await get_settings()
    bronze_pct = float(s.get("referral_bronze_pct", 5.0))
    silver_pct = float(s.get("referral_silver_pct", 7.0))
    silver_thr = int(s.get("referral_silver_threshold", 10))
    gold_pct = float(s.get("referral_gold_pct", 10.0))
    gold_thr = int(s.get("referral_gold_threshold", 50))
    if count >= gold_thr:
        return ("gold", gold_pct, None, None)
    if count >= silver_thr:
        return ("silver", silver_pct, "gold", gold_thr)
    return ("bronze", bronze_pct, "silver", silver_thr)


async def tier_pct_for_user_count(count: int) -> float:
    tier, pct, _, _ = await tier_for_count(count)
    return pct / 100.0  # decimal multiplier
