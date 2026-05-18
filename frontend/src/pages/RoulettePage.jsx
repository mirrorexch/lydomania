/**
 * Phase 6c → 6e — Roulette page (gift-prize mode).
 *
 * Replaces the open-range bet input with three fixed tier pills (1 / 5 / 25 TON).
 * Below the wheel: "This round you could win" basket preview that swaps with
 *   the active (tier, color) selection.
 * The live bets feed shows item thumbs instead of TON payout amounts.
 * Post-spin win reveal modal with "Sell at floor" + "Keep" CTAs.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Diamond, Shield, Loader2, X, Sparkles, ArrowRight } from "lucide-react";

import {
    http, resolveImage, fetchRouletteBaskets, sellInventoryItem,
} from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { openRouletteSocket } from "@/lib/rouletteWs";
import { RouletteWheel } from "@/components/RouletteWheel";

const COLOR_BG = {
    red: "bg-rose-600",
    black: "bg-zinc-800",
    green: "bg-emerald-500",
};
const TIERS = [1, 5, 25];

export default function RoulettePage({ user, refreshBalance }) {
    const { t } = useTranslation();
    const [state, setState] = useState(null);
    const [bets, setBets] = useState([]);
    const [history, setHistory] = useState([]);
    const [betTier, setBetTier] = useState(1);
    const [previewColor, setPreviewColor] = useState("red");
    const [busyColor, setBusyColor] = useState(null);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [showVerifier, setShowVerifier] = useState(false);
    const [verifyData, setVerifyData] = useState(null);
    const [baskets, setBaskets] = useState([]);    // 9 baskets
    const [reveal, setReveal] = useState(null);    // { item_slug, item_name, image_url, floor, inventory_id }
    const [revealBusy, setRevealBusy] = useState(false);
    const tickRef = useRef(null);
    const spinAudio = useRef({ playing: false, last: 0 });
    const lastSeenWonInvIds = useRef(new Set());

    // --- WebSocket wiring (unchanged) ---
    useEffect(() => {
        const conn = openRouletteSocket({
            onMessage: (msg) => {
                if (msg.type === "state" || msg.type === "phase") {
                    setState((prev) => {
                        const merged = { ...(prev || {}), ...msg };
                        if (msg.bets_feed) merged.bets_feed = msg.bets_feed;
                        if (msg.recent_results) merged.recent_results = msg.recent_results;
                        return merged;
                    });
                } else if (msg.type === "new_bet") {
                    setBets((prev) => [msg, ...prev].slice(0, 30));
                    setState((prev) => prev ? {
                        ...prev,
                        totals: msg.totals || prev.totals,
                        bet_count: msg.bet_count ?? prev.bet_count,
                    } : prev);
                } else if (msg.type === "round_settled") {
                    setHistory((prev) => [msg, ...prev].slice(0, 20));
                    if (refreshBalance) refreshBalance();
                    // Pop reveal modal if a winning bet of THIS user landed
                    const my = (msg.items_awarded || []).filter(
                        (a) => a.user_id === user?.id && !lastSeenWonInvIds.current.has(a.bet_id),
                    );
                    if (my.length) {
                        my.forEach((a) => lastSeenWonInvIds.current.add(a.bet_id));
                        // Fetch the most-recent inventory item details
                        http.get("/inventory?status=in_inventory&limit=5").then(({ data }) => {
                            const it = (data.items || []).find(
                                (i) => i.case_id === "roulette" && i.roll_id?.includes(msg.round_id),
                            ) || (data.items || [])[0];
                            if (it) setReveal(it);
                        }).catch(() => {});
                    }
                }
            },
        });
        return () => conn.close();
    }, [refreshBalance, user?.id]);

    // Hydrate state + history + baskets
    useEffect(() => {
        (async () => {
            try {
                const [{ data: snap }, { data: hist }, basketsRes] = await Promise.all([
                    http.get("/roulette/state"),
                    http.get("/roulette/history?limit=20"),
                    fetchRouletteBaskets(),
                ]);
                setState(snap);
                if (snap.bets_feed) setBets(snap.bets_feed);
                setHistory(hist.rows || []);
                setBaskets(basketsRes.baskets || []);
            } catch (e) { /* WS will catch up */ }
        })();
    }, []);

    // Countdown ticker
    useEffect(() => {
        const compute = () => {
            const ends = state?.phase_ends_at;
            if (!ends) { setSecondsLeft(0); return; }
            const dt = new Date(ends) - new Date();
            setSecondsLeft(Math.max(0, Math.ceil(dt / 1000)));
        };
        compute();
        tickRef.current = setInterval(compute, 200);
        return () => clearInterval(tickRef.current);
    }, [state?.phase_ends_at]);

    // Spin tick SFX
    useEffect(() => {
        if (state?.phase !== "spinning") return;
        const startedAt = Date.now();
        const dur = 8000;
        const id = setInterval(() => {
            const t2 = (Date.now() - startedAt) / dur;
            const interval = 80 + 380 * t2 * t2;
            if (Date.now() - spinAudio.current.last > interval) {
                sfx.play("scroll_tick", { volume: 0.45 });
                spinAudio.current.last = Date.now();
            }
        }, 60);
        return () => clearInterval(id);
    }, [state?.phase]);

    const phase = state?.phase || "—";
    const canBet = phase === "betting" && secondsLeft > 0;
    const totals = state?.totals || { red: 0, black: 0, green: 0 };

    // Find the active (tier, previewColor) basket
    const activeBasket = useMemo(() => {
        return baskets.find((b) => b.tier === betTier && b.color === previewColor);
    }, [baskets, betTier, previewColor]);

    const placeBet = useCallback(async (color) => {
        if (!canBet || !state?.round_id) {
            toast.error(t("roulette.toast.not_betting")); return;
        }
        setBusyColor(color);
        setPreviewColor(color);
        try {
            const { data } = await http.post("/roulette/bet", {
                round_id: state.round_id, color, amount_ton: betTier,
            });
            sfx.play("coin_drop", { volume: 0.6 });
            toast.success(t("roulette.toast.bet_ok", {
                amount: formatTON(betTier),
                color: t(`roulette.color.${color}`),
                balance: formatTON(data.balance_ton),
            }));
            if (refreshBalance) refreshBalance();
        } catch (e) {
            const msg = e?.response?.data?.detail || "bet failed";
            toast.error(typeof msg === "string" ? msg : "bet failed");
        } finally {
            setBusyColor(null);
        }
    }, [betTier, canBet, state?.round_id, t, refreshBalance]);

    const openVerifier = useCallback(async (roundId) => {
        setShowVerifier(true);
        setVerifyData(null);
        try {
            const { data } = await http.get(`/roulette/rounds/${roundId}/verify`);
            setVerifyData(data);
        } catch (e) {
            toast.error("verifier unavailable");
            setShowVerifier(false);
        }
    }, []);

    const sellRevealed = useCallback(async () => {
        if (!reveal?.id) return;
        setRevealBusy(true);
        try {
            const r = await sellInventoryItem(reveal.id);
            if (r.instant_credit) {
                toast.success(t("roulette.reveal.sold_ok", {
                    credited: formatTON(r.credited_ton),
                    balance: formatTON(r.balance_ton),
                }));
            } else {
                toast.success(t("roulette.reveal.queued_review"));
            }
            if (refreshBalance) refreshBalance();
            setReveal(null);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "sell failed");
        } finally {
            setRevealBusy(false);
        }
    }, [reveal, refreshBalance, t]);

    const phaseLabel = useMemo(() => {
        if (phase === "betting") return t("roulette.phase.betting", { s: secondsLeft });
        if (phase === "locking") return t("roulette.phase.locking");
        if (phase === "spinning") return t("roulette.phase.spinning");
        if (phase === "payout") return t("roulette.phase.payout",
            { color: state?.winning_color ? t(`roulette.color.${state.winning_color}`) : "" });
        return phase;
    }, [phase, secondsLeft, state?.winning_color, t]);

    return (
        <main className="mx-auto px-3 sm:px-6 pt-4 pb-24 lg:pb-6 space-y-5 max-w-[430px] sm:max-w-[640px] lg:max-w-[960px] xl:max-w-[1100px]"
              data-testid="roulette-page">
            {/* Header */}
            <header className="flex items-center justify-between gap-2 sticky top-[52px] lg:top-0 z-20 -mx-1 px-1 py-2 bg-cyber-bg/85 backdrop-blur-xl">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400 font-bold">{t("roulette.tag")}</div>
                    <div data-testid="roulette-phase-label" className="text-base sm:text-lg font-display font-extrabold text-white">{phaseLabel}</div>
                </div>
                <button
                    onClick={() => state?.recent_results?.[0]?.round_id && openVerifier(state.recent_results[0].round_id)}
                    data-testid="roulette-pf-btn"
                    className="text-[10px] sm:text-xs flex items-center gap-1.5 bg-white/[0.04] border border-white/10 hover:border-cyan-400/40 rounded-full px-3 py-1.5 transition"
                >
                    <Shield className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="font-semibold uppercase tracking-wider">{t("roulette.provably_fair")}</span>
                </button>
            </header>

            {/* Wheel */}
            <RouletteWheel phase={phase} segmentIndex={state?.segment_index} />

            {/* History strip */}
            <div data-testid="roulette-history" className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold mr-1 flex-shrink-0">
                    {t("roulette.history_label")}
                </span>
                {(state?.recent_results || []).map((r) => (
                    <button
                        key={r.round_id}
                        onClick={() => openVerifier(r.round_id)}
                        data-testid={`history-pill-${r.winning_color}`}
                        className={`flex-shrink-0 w-7 h-7 rounded-full ${COLOR_BG[r.winning_color]} text-[10px] font-bold flex items-center justify-center border border-white/10 hover:border-cyan-400/40 transition`}
                        title={`#${r.round_id.slice(0, 6)} · ${r.winning_color}`}
                    >
                        {r.winning_color === "green" ? "★" : r.segment_index.toString().padStart(2, "0")}
                    </button>
                ))}
            </div>

            {/* TIER PILLS (1 / 5 / 25) */}
            <div className="flex items-center gap-2 flex-wrap" data-testid="roulette-tier-pills">
                <span className="text-[10px] uppercase tracking-wider text-white/50 font-bold mr-1">
                    {t("roulette.bet_tier")}
                </span>
                {TIERS.map((c) => {
                    const active = betTier === c;
                    return (
                        <button
                            key={c}
                            onClick={() => setBetTier(c)}
                            data-testid={`tier-${c}`}
                            className={`px-4 py-1.5 rounded-full text-sm font-bold border transition tabular-nums ${
                                active
                                    ? "bg-cyber-cyan/20 text-cyber-cyan border-cyber-cyan/55 shadow-[0_0_15px_rgba(56,182,255,0.35)]"
                                    : "bg-white/[0.04] text-white/60 border-white/10 hover:text-white hover:border-white/25"
                            }`}
                        >
                            {c} TON
                        </button>
                    );
                })}
            </div>

            {/* Color buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {["red", "black", "green"].map((color) => (
                    <button
                        key={color}
                        onClick={() => placeBet(color)}
                        onMouseEnter={() => setPreviewColor(color)}
                        onFocus={() => setPreviewColor(color)}
                        disabled={!canBet || busyColor !== null}
                        data-testid={`bet-${color}-btn`}
                        className={`relative h-24 rounded-2xl ${COLOR_BG[color]} border-2 ${
                            previewColor === color ? "border-white/60" : "border-white/10"
                        } hover:border-white/40 disabled:opacity-50 disabled:cursor-not-allowed transition flex flex-col items-center justify-center font-display`}
                    >
                        <span className="text-[10px] uppercase tracking-[0.3em] text-white/80">
                            {t(`roulette.color.${color}`)}
                        </span>
                        <span className="text-2xl font-extrabold text-white">
                            {betTier} TON → {t("roulette.cta_gift")}
                        </span>
                        <span className="text-[11px] text-white/80 mt-0.5">
                            {t("roulette.pot", { amount: formatTON(totals[color] || 0) })}
                        </span>
                        {busyColor === color && (
                            <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-white" />
                        )}
                    </button>
                ))}
            </div>

            {/* BASKET PREVIEW — "This round you could win:" */}
            {activeBasket && (
                <section
                    data-testid="roulette-basket-preview"
                    className="rounded-2xl border border-white/10 bg-cyber-surface/60 p-3"
                >
                    <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
                        <div className="text-[11px] uppercase tracking-wider text-white/55 font-bold flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-cyber-cyan" />
                            {t("roulette.basket_title")}
                        </div>
                        <div className="text-[10px] text-white/40 tabular-nums">
                            {t("roulette.basket_subtitle", {
                                tier: betTier,
                                color: t(`roulette.color.${previewColor}`),
                                expected: formatTON(activeBasket.expected_floor_ton),
                            })}
                        </div>
                    </div>
                    <div
                        className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                        data-testid="roulette-basket-grid"
                    >
                        {activeBasket.items.map((it) => (
                            <div
                                key={it.item_slug}
                                className="bg-white/[0.04] border border-white/10 rounded-lg p-2 flex flex-col items-center text-center hover:border-cyber-cyan/35 transition"
                                title={`${it.item_name} · ${it.draw_pct}% draw chance`}
                            >
                                <img
                                    src={resolveImage(it.image_url)}
                                    alt={it.item_name}
                                    className="w-12 h-12 sm:w-14 sm:h-14 object-contain drop-shadow-[0_0_8px_rgba(56,182,255,0.25)] mb-1"
                                    draggable={false}
                                    loading="lazy"
                                />
                                <div className="text-[10px] text-white/85 font-bold truncate w-full">{it.item_name}</div>
                                <div className="text-[10px] text-cyber-cyan tabular-nums">{formatTON(it.floor_ton)} TON</div>
                                <div className="text-[9px] text-white/35 tabular-nums">{it.draw_pct}%</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Live bets feed — shows winning_item_slug for settled bets */}
            <section className="rounded-2xl border border-white/10 bg-cyber-surface/60 p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] uppercase tracking-wider text-white/50 font-bold">
                        {t("roulette.bets_feed")}
                    </span>
                    <span className="text-[10px] text-white/40 tabular-nums">{state?.bet_count || 0}</span>
                </div>
                <div data-testid="roulette-bets-feed" className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                    {bets.length === 0 && (
                        <div className="text-center text-[11px] text-white/30 py-6">{t("roulette.no_bets_yet")}</div>
                    )}
                    {bets.map((b) => (
                        <div key={b.bet_id} className="flex items-center gap-2 text-xs">
                            <span className={`w-2 h-2 rounded-full ${COLOR_BG[b.color]} flex-shrink-0`} />
                            <span className="font-mono text-white/70 truncate">@{b.username || `tg${b.telegram_id}`}</span>
                            <span className="text-white/40 tabular-nums ml-auto flex-shrink-0">
                                {b.amount_ton} TON
                            </span>
                            {b.winning_item_slug ? (
                                <span className="text-cyber-cyan font-bold text-[10px] truncate max-w-[120px]">
                                    🎁 {b.winning_item_name || b.winning_item_slug}
                                </span>
                            ) : null}
                        </div>
                    ))}
                </div>
            </section>

            {showVerifier && (
                <ProvablyFairModal data={verifyData} onClose={() => setShowVerifier(false)} />
            )}

            {/* WIN REVEAL */}
            <AnimatePresence>
                {reveal && (
                    <motion.div
                        data-testid="roulette-win-reveal"
                        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setReveal(null)}
                    >
                        <motion.div
                            initial={{ y: 80, opacity: 0, scale: 0.95 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ type: "spring", damping: 22, stiffness: 280 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full sm:max-w-sm bg-cyber-surface border border-cyber-cyan/35 rounded-3xl p-6 text-center shadow-[0_0_60px_rgba(56,182,255,0.45)]"
                        >
                            <button
                                onClick={() => setReveal(null)}
                                data-testid="reveal-close"
                                className="absolute top-3 right-3 text-white/50 hover:text-white p-1"
                                aria-label="close"
                            ><X className="w-5 h-5" /></button>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-cyber-cyan font-bold mb-2">
                                {t("roulette.reveal.won_tag")}
                            </div>
                            <img
                                src={resolveImage(reveal.image_url)}
                                alt={reveal.item_name}
                                className="w-40 h-40 mx-auto object-contain drop-shadow-[0_0_30px_rgba(56,182,255,0.6)] mb-3"
                            />
                            <div className="font-display text-2xl font-black mb-1">{reveal.item_name}</div>
                            <div className="text-cyber-cyan font-bold text-lg mb-5 tabular-nums">
                                {formatTON(reveal.payout_ton)} TON
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    data-testid="reveal-keep"
                                    onClick={() => setReveal(null)}
                                    className="rounded-xl py-3 bg-white/[0.07] border border-white/15 hover:border-white/30 font-bold uppercase tracking-wider text-xs"
                                >
                                    {t("roulette.reveal.keep")}
                                </button>
                                <button
                                    data-testid="reveal-sell"
                                    onClick={sellRevealed}
                                    disabled={revealBusy}
                                    className="rounded-xl py-3 bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-bold uppercase tracking-wider text-xs disabled:opacity-60 inline-flex items-center justify-center gap-1"
                                >
                                    {revealBusy ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        <>{t("roulette.reveal.sell")} <ArrowRight className="w-3.5 h-3.5" /></>}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
}


function ProvablyFairModal({ data, onClose }) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3 backdrop-blur-sm"
             onClick={onClose} data-testid="roulette-verify-modal">
            <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-cyber-surface border border-cyan-400/20 rounded-2xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-cyan-300" />
                        <h2 className="font-display font-bold text-lg">{t("roulette.verify.title")}</h2>
                    </div>
                    <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                {!data && <div className="py-10 text-center text-white/40"><Loader2 className="w-5 h-5 animate-spin inline-block" /></div>}
                {data && (
                    <div className="space-y-3 text-xs">
                        <Row k="round_id" v={data.round_id} />
                        <Row k="winning_color" v={data.winning_color} />
                        <Row k="segment_index" v={String(data.segment_index)} />
                        <Row k="server_seed_hash" v={data.server_seed_hash} mono />
                        <Row k="server_seed (revealed)" v={data.server_seed} mono />
                        <Row k="client_seed_combined" v={data.client_seed_combined} mono />
                        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-lg p-3 space-y-1">
                            <div>✓ server_seed_hash {data.server_seed_hash_matches ? "matches" : "DOES NOT MATCH"}</div>
                            <div>✓ client_seed reconstruction {data.client_seed_combined_matches ? "matches" : "DOES NOT MATCH"}</div>
                            <div>✓ recomputed segment = {data.recomputed_segment_index} ({data.recomputed_color}) → {data.segment_index_matches ? "MATCHES" : "MISMATCH"}</div>
                            {Array.isArray(data.item_picks) && data.item_picks.length > 0 && (
                                <div className="pt-1 border-t border-emerald-500/30">
                                    {t("roulette.verify.item_picks", { n: data.item_picks.length })}{" — "}
                                    {data.item_picks.every((p) => p.matches)
                                        ? <span>{t("roulette.verify.all_match")}</span>
                                        : <span className="text-rose-300">{t("roulette.verify.mismatch")}</span>}
                                </div>
                            )}
                        </div>
                        <div className="text-white/40 text-[10px] mt-2">{data.derivation_note}</div>
                    </div>
                )}
            </motion.div>
        </div>
    );
}

const Row = ({ k, v, mono }) => (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-baseline">
        <span className="text-white/40 uppercase text-[10px] tracking-wider">{k}</span>
        <span className={`text-white/90 break-all ${mono ? "font-mono text-[10px]" : ""}`}>{v}</span>
    </div>
);
