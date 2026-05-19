"""Phase 8 — Central action recorder.

Single fan-out point for game-end events. Each game calls
    await record_action(user_id, kind, amount_ton=…, multiplier=…)

…and we forward to:
   • XP awarding (via services.season.award_xp)
   • Mission progress (via services.missions.update_progress)
   • Achievement progress (via services.achievements.evaluate_after)
   • Live activity broadcast (via services.activity.maybe_broadcast)

All hooks are best-effort: a failure in one shouldn't block another.
"""
from __future__ import annotations

import logging
from typing import Any

LOG = logging.getLogger("lydomania.actions")

# Map action kind → (xp_per_unit, unit_field). Unit is either 'ton' (multiply
# by amount_ton) or 'each' (flat per call).
_XP_RULES: dict[str, tuple[float, str]] = {
    "plinko_drop":   (1.0, "ton"),       # 1 XP per TON wagered
    "mines_cashout": (2.0, "ton"),       # 2 XP per TON wagered (winning game)
    "mines_bust":    (0.5, "ton"),       # token consolation
}


async def record_action(
    user_id: str,
    kind: str,
    *,
    event_id: str,
    amount_ton: float = 0.0,
    multiplier: float | None = None,
    payout_ton: float = 0.0,
    item_slug: str | None = None,
    game: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fan out a game event. event_id MUST be globally unique for idempotency."""
    extra = extra or {}
    game = game or kind.split("_")[0]

    # 1. XP — for kinds covered by _XP_RULES (case/wheel/roulette/battles/crash
    #    have their own dedicated hooks already wired in services).
    try:
        rule = _XP_RULES.get(kind)
        if rule:
            xp = int(rule[0] * (amount_ton if rule[1] == "ton" else 1))
            if xp > 0:
                from services.season import award_xp
                await award_xp(user_id, xp, kind if kind in (
                    "wheel_spin", "case_open", "roulette_win", "crash_cashout", "battle_win",
                ) else "admin_grant", event_id)
    except Exception as e:  # noqa: BLE001
        LOG.warning("record_action: XP hook failed (%s/%s): %s", kind, event_id, e)

    # 2. Missions
    try:
        from services.missions import update_progress
        await update_progress(user_id, kind, amount_ton=amount_ton)
    except Exception as e:  # noqa: BLE001
        LOG.warning("record_action: mission hook failed: %s", e)

    # 3. Achievements
    try:
        from services.achievements import evaluate_after
        await evaluate_after(
            user_id, kind,
            amount_ton=amount_ton, multiplier=multiplier, payout_ton=payout_ton,
        )
    except Exception as e:  # noqa: BLE001
        LOG.warning("record_action: achievements hook failed: %s", e)

    # 4. Live activity (only big wins)
    try:
        from services.activity import maybe_broadcast
        await maybe_broadcast(
            user_id, game=game, kind=kind,
            payout_ton=payout_ton, multiplier=multiplier, item_slug=item_slug,
        )
    except Exception as e:  # noqa: BLE001
        LOG.warning("record_action: activity hook failed: %s", e)

    # 5. VIP lifetime_wagered_ton bump (Phase 9)
    try:
        if amount_ton > 0:
            from services.vip import increment_wagered
            await increment_wagered(user_id, amount_ton)
    except Exception as e:  # noqa: BLE001
        LOG.warning("record_action: VIP wager hook failed: %s", e)

    return {"ok": True}
