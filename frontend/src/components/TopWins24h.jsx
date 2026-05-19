/**
 * Phase 11 / Fix-K — "Top Wins · Last 24h" home section.
 *
 * Fetches /api/activity/top-24h?filter=... and renders a responsive card
 * grid (xl:4 · lg:3 · md:2 · mobile snap-scroll). Filter chips: All ·
 * ≥5× · ≥10 TON · By Game (lucide chevron dropdown).
 *
 * WS-aware: subscribes to the same /api/ws/activity hub the marquee uses,
 * and re-queries on each new event so the grid stays fresh while the
 * page is open.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Sparkles, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { GameIcon } from "@/components/common/GameIcon";
import { GiftCard } from "@/components/common/GiftCard";
import { staggerChildren, fadeInUp, PRM } from "@/lib/motion";

const GAME_SLUGS = ["wheel", "plinko", "mines", "crash", "roulette", "battles", "cases"];

const FILTER_BUILTINS = [
    { key: "all",         label: "All" },
    { key: "big_mult",    label: "≥ 5×" },
    { key: "big_payout",  label: "≥ 10 TON" },
];

function wsUrl() {
    const base = process.env.REACT_APP_BACKEND_URL || "";
    if (!base) return "";
    return base.replace(/^http/, "ws") + "/api/ws/activity";
}

export const TopWins24h = () => {
    const { t } = useTranslation();
    const [filter, setFilter] = useState("all");
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [gameMenuOpen, setGameMenuOpen] = useState(false);
    const wsRef = useRef(null);

    const fetchRows = useCallback(async (f) => {
        setLoading(true);
        try {
            const { data } = await http.get("/activity/top-24h", { params: { filter: f, limit: 24 } });
            setRows(data?.rows || []);
        } catch { /* silent */ } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchRows(filter); }, [filter, fetchRows]);

    // Live refresh on every new activity event (small debounce via timeout)
    useEffect(() => {
        const url = wsUrl();
        if (!url || typeof WebSocket === "undefined") return;
        let pending = null;
        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;
            ws.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === "activity") {
                        if (pending) clearTimeout(pending);
                        pending = setTimeout(() => fetchRows(filter), 1500);
                    }
                } catch { /* */ }
            };
        } catch { /* */ }
        return () => {
            if (pending) clearTimeout(pending);
            try { wsRef.current?.close(); } catch { /* */ }
        };
    }, [filter, fetchRows]);

    const activeFilterLabel = useMemo(() => {
        if (filter.startsWith("game:")) {
            const slug = filter.split(":")[1];
            return slug.charAt(0).toUpperCase() + slug.slice(1);
        }
        const f = FILTER_BUILTINS.find((x) => x.key === filter);
        return f?.label || "All";
    }, [filter]);

    return (
        <section
            data-testid="top-wins-24h"
            className="space-y-3"
            aria-label="Top wins last 24 hours"
        >
            {/* Header + filter row */}
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                    <Trophy className="w-5 h-5 text-gold-bright drop-shadow-[0_0_12px_rgba(255,215,0,0.55)]" />
                    <div>
                        <h2 className="font-display text-base sm:text-lg font-black tracking-tight text-white">
                            Top Wins
                        </h2>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-gold-300/70 font-bold leading-none">
                            Last 24 hours
                        </p>
                    </div>
                </div>
                {/* Filter chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {FILTER_BUILTINS.map((f) => (
                        <Chip
                            key={f.key}
                            active={filter === f.key}
                            onClick={() => { setFilter(f.key); setGameMenuOpen(false); }}
                            testid={`top-wins-filter-${f.key}`}
                        >
                            {f.label}
                        </Chip>
                    ))}
                    {/* By Game dropdown */}
                    <div className="relative">
                        <Chip
                            active={filter.startsWith("game:")}
                            onClick={() => setGameMenuOpen((v) => !v)}
                            testid="top-wins-filter-bygame"
                        >
                            {filter.startsWith("game:") ? `· ${activeFilterLabel}` : "By Game"}
                            <ChevronDown className="w-3 h-3" />
                        </Chip>
                        <AnimatePresence>
                            {gameMenuOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: 0.16 }}
                                    className="absolute right-0 mt-1 z-20 min-w-[140px] rounded-lg bg-zinc-900 border border-gold-500/25 shadow-gold-glow-lg overflow-hidden"
                                    data-testid="top-wins-bygame-menu"
                                >
                                    {GAME_SLUGS.map((g) => (
                                        <button
                                            key={g}
                                            onClick={() => { setFilter(`game:${g}`); setGameMenuOpen(false); }}
                                            data-testid={`top-wins-bygame-${g}`}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/85 hover:bg-gold-500/10 hover:text-gold-200 transition-colors"
                                        >
                                            <GameIcon game={g} size="sm" className="!w-6 !h-6" />
                                            <span className="capitalize">{g}</span>
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Grid / empty state */}
            {rows.length === 0 ? (
                <EmptyState loading={loading} />
            ) : (
                <motion.div
                    initial={PRM() ? false : "initial"}
                    animate="animate"
                    variants={staggerChildren(0.04)}
                    className="
                        grid gap-3
                        grid-flow-col auto-cols-[78%] overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1
                        md:grid-flow-row md:auto-cols-fr md:grid-cols-2 md:overflow-x-visible md:pb-0
                        lg:grid-cols-3 xl:grid-cols-4
                    "
                    data-testid="top-wins-24h-grid"
                >
                    {rows.map((row) => (
                        <WinCard key={row.id} row={row} />
                    ))}
                </motion.div>
            )}
        </section>
    );
};


const WinCard = ({ row }) => {
    const m = Number(row.multiplier) || 0;
    // Phase 11.1 — TopWins cards unified via shared <GiftCard>
    const itemForCard = {
        id: row.id,
        item_name: row.item_slug
            ? row.item_slug.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())
            : row.game,
        item_slug: row.item_slug,
        rarity: row.rarity || (m >= 10 ? "legendary" : m >= 5 ? "epic" : "rare"),
        image_url: row.item_slug ? `items/${row.item_slug}.png` : null,
        payout_ton: row.payout_ton,
    };
    return (
        <motion.div
            variants={fadeInUp}
            className="snap-start flex-shrink-0 min-w-0"
            data-testid={`top-wins-card-${row.id}`}
        >
            <GiftCard
                item={itemForCard}
                size="md"
                multiplierBadge={m > 0 ? m : undefined}
                priceChip={`+${formatTON(row.payout_ton)} TON`}
                className="!w-full"
            />
            <div className="mt-1.5 flex items-center justify-between gap-1.5 px-1">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase text-gold-300/70 font-bold">
                    <GameIcon game={row.game} size="sm" className="!w-5 !h-5" />
                    <span className="truncate">{row.game}</span>
                </span>
                <span className="text-[11px] text-white/55 font-semibold truncate">@{row.user_handle}</span>
            </div>
        </motion.div>
    );
};


const Chip = ({ active, onClick, children, testid }) => (
    <button
        onClick={onClick}
        data-testid={testid}
        className={
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition " +
            (active
                ? "bg-gold-bright text-zinc-950 shadow-[0_0_14px_rgba(255,215,0,0.45)]"
                : "bg-white/5 text-gold-200 border border-gold-500/25 hover:border-gold-bright/55 hover:text-gold-bright"
            )
        }
    >
        {children}
    </button>
);


const EmptyState = ({ loading }) => (
    <div
        data-testid="top-wins-empty"
        className="rounded-2xl border border-dashed border-gold-500/20 bg-surface-1 px-6 py-10 text-center"
    >
        <Sparkles className="w-7 h-7 mx-auto text-gold-bright/65 mb-2 animate-pulse" />
        <p className="text-white/70 text-sm font-semibold">
            {loading ? "Loading recent wins…" : "No big wins in this window yet"}
        </p>
        <p className="text-[11px] text-gold-300/55 mt-1">
            Be the first 💰 — open a case or spin the wheel.
        </p>
    </div>
);

export default TopWins24h;
