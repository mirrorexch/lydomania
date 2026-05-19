"""Phase 8 — Achievements catalog.

15 starter achievements covering early/mid/late-game milestones.
Each has a deterministic ID, copy, criteria predicate, and reward.

Criteria contract: a dict with shape:
   {kind: "counter", source: <action_kind>, target: <int>}
   {kind: "single",  source: <action_kind>}             # any single occurrence
   {kind: "threshold", source: <action_kind>, target: <int>}  # cumulative TON
"""
from __future__ import annotations

from typing import Any, Final

CATALOG: Final[list[dict[str, Any]]] = [
    # ── First-time milestones (single) ────────────────────────────────────
    {
        "achievement_id": "first_spin",
        "name": "First Spin",
        "description": "Spin the Wheel of Fortune for the first time.",
        "category": "starter", "icon": "sparkles",
        "criteria": {"kind": "single", "source": "wheel_spin"},
        "reward":   {"type": "xp", "amount": 50},
    },
    {
        "achievement_id": "first_case_open",
        "name": "Box Opener",
        "description": "Open your first case.",
        "category": "starter", "icon": "package",
        "criteria": {"kind": "single", "source": "case_open"},
        "reward":   {"type": "xp", "amount": 50},
    },
    {
        "achievement_id": "first_roulette_win",
        "name": "Roulette Royalty",
        "description": "Win your first roulette bet.",
        "category": "starter", "icon": "disc",
        "criteria": {"kind": "single", "source": "roulette_win"},
        "reward":   {"type": "xp", "amount": 50},
    },
    {
        "achievement_id": "first_crash_cashout",
        "name": "Ride the Rocket",
        "description": "Cash out a Crash round above 1.00×.",
        "category": "starter", "icon": "rocket",
        "criteria": {"kind": "single", "source": "crash_cashout"},
        "reward":   {"type": "xp", "amount": 75},
    },
    {
        "achievement_id": "first_plinko",
        "name": "Drop Zone",
        "description": "Drop your first Plinko ball.",
        "category": "starter", "icon": "circle-dot",
        "criteria": {"kind": "single", "source": "plinko_drop"},
        "reward":   {"type": "xp", "amount": 50},
    },
    {
        "achievement_id": "first_mines",
        "name": "Tread Carefully",
        "description": "Cash out your first Mines round.",
        "category": "starter", "icon": "bomb",
        "criteria": {"kind": "single", "source": "mines_cashout"},
        "reward":   {"type": "xp", "amount": 50},
    },
    # ── Counter milestones ────────────────────────────────────────────────
    {
        "achievement_id": "open_50_cases",
        "name": "Case Master",
        "description": "Open 50 cases.",
        "category": "grinder", "icon": "package-2",
        "criteria": {"kind": "counter", "source": "case_open", "target": 50},
        "reward":   {"type": "free_spin", "count": 3},
    },
    {
        "achievement_id": "spin_25_wheels",
        "name": "Wheel Veteran",
        "description": "Spin the wheel 25 times.",
        "category": "grinder", "icon": "disc-3",
        "criteria": {"kind": "counter", "source": "wheel_spin", "target": 25},
        "reward":   {"type": "free_spin", "count": 2},
    },
    {
        "achievement_id": "drop_100_plinko",
        "name": "Pinball Wizard",
        "description": "Drop 100 Plinko balls.",
        "category": "grinder", "icon": "circle-dot",
        "criteria": {"kind": "counter", "source": "plinko_drop", "target": 100},
        "reward":   {"type": "ton", "amount_ton": 5.0},
    },
    {
        "achievement_id": "win_10_battles",
        "name": "Battle-Hardened",
        "description": "Win 10 battles.",
        "category": "grinder", "icon": "swords",
        "criteria": {"kind": "counter", "source": "battle_win", "target": 10},
        "reward":   {"type": "ton", "amount_ton": 3.0},
    },
    # ── Big-win achievements (event-shaped) ───────────────────────────────
    {
        "achievement_id": "hit_5x_multiplier",
        "name": "5× Multiplier",
        "description": "Hit a 5× multiplier or higher in any game.",
        "category": "highroller", "icon": "trending-up",
        "criteria": {"kind": "single", "source": "big_multiplier_5x"},
        "reward":   {"type": "xp", "amount": 200},
    },
    {
        "achievement_id": "hit_50x_multiplier",
        "name": "50× Multiplier",
        "description": "Hit a 50× multiplier or higher in any game.",
        "category": "highroller", "icon": "zap",
        "criteria": {"kind": "single", "source": "big_multiplier_50x"},
        "reward":   {"type": "ton", "amount_ton": 5.0},
    },
    {
        "achievement_id": "win_100_ton_total",
        "name": "Hundred-Toner",
        "description": "Accumulate 100 TON in total winnings.",
        "category": "highroller", "icon": "coins",
        "criteria": {"kind": "threshold", "source": "ton_won", "target": 100},
        "reward":   {"type": "ton", "amount_ton": 10.0},
    },
    {
        "achievement_id": "reach_tier_30",
        "name": "Season Champion",
        "description": "Reach tier 30 in any Battle Pass season.",
        "category": "season", "icon": "crown",
        "criteria": {"kind": "single", "source": "season_tier_30"},
        "reward":   {"type": "ton", "amount_ton": 25.0},
    },
    {
        "achievement_id": "premium_unlocked",
        "name": "Premium Pioneer",
        "description": "Unlock the Battle Pass Premium track.",
        "category": "season", "icon": "shield-check",
        "criteria": {"kind": "single", "source": "premium_unlock"},
        "reward":   {"type": "xp", "amount": 100},
    },
]


def by_id(achievement_id: str) -> dict[str, Any] | None:
    for a in CATALOG:
        if a["achievement_id"] == achievement_id:
            return a
    return None


def evaluate_progress(criteria: dict, current: dict) -> tuple[bool, int, int]:
    """Returns (unlocked, current_value, target_value)."""
    kind = criteria.get("kind")
    src = criteria.get("source")
    if kind == "single":
        cur = int(current.get(src, 0))
        return (cur >= 1, min(cur, 1), 1)
    if kind == "counter":
        tgt = int(criteria.get("target") or 1)
        cur = int(current.get(src, 0))
        return (cur >= tgt, min(cur, tgt), tgt)
    if kind == "threshold":
        tgt = int(criteria.get("target") or 1)
        cur = int(current.get(src, 0))
        return (cur >= tgt, min(cur, tgt), tgt)
    return (False, 0, 1)
