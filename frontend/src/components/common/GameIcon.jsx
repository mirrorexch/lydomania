/**
 * Phase 11 — Game / category icon pill helper.
 *
 * Maps a game key to a lucide-react icon inside a warm-gold gradient
 * pill (12x12 default). Used by Cases banners, Live Wins ticker, Top
 * Wins 24h grid, leaderboard rows.
 *
 *   <GameIcon game="wheel" size="md" />
 *
 * Sizes:  sm (32px)  ·  md (44px)  ·  lg (56px)
 */
import React from "react";
import {
    Swords, Disc3, Rocket, ChevronsDown, Bomb, Target,
    Coins, Sparkles, Crown, Ticket,
} from "lucide-react";

const GAME_ICON = {
    case:       Sparkles,
    cases:      Sparkles,
    case_open:  Sparkles,
    battle:     Swords,
    battles:    Swords,
    pvp:        Swords,
    roulette:   Target,
    wheel:      Disc3,
    crash:      Rocket,
    plinko:     ChevronsDown,
    mines:      Bomb,
    jackpot:    Crown,
    mission:    Ticket,
    free:       Coins,
};

const SIZE = {
    sm: "w-8 h-8",
    md: "w-11 h-11",
    lg: "w-14 h-14",
};

const ICON_SIZE = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
};

export const GameIcon = ({ game, size = "md", className = "", ...rest }) => {
    const Icon = GAME_ICON[(game || "").toLowerCase()] || Sparkles;
    return (
        <span
            className={
                `inline-grid place-items-center rounded-xl ${SIZE[size]} ` +
                "bg-gradient-to-br from-gold-400/20 to-gold-700/15 " +
                "border border-gold-500/30 text-gold-300 shrink-0 " +
                "shadow-[inset_0_1px_0_0_rgba(255,215,0,0.18)] " +
                className
            }
            aria-label={game}
            {...rest}
        >
            <Icon className={ICON_SIZE[size]} strokeWidth={2.2} />
        </span>
    );
};

export default GameIcon;
