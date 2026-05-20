import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Disc3, Coins, Sparkles, Crown, Ticket, History, Shield, ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http, resolveImage } from "@/lib/api";
import { formatTON, RARITY_HEX } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import {
    tapMedium, tapHeavy, notifySuccess, notifyError, notifyWarning, selectionChanged,
} from "@/lib/haptics";
import { RollingNumber } from "@/components/RollingNumber";
import WheelFairnessModal from "@/components/wheel/WheelFairnessModal";
import FairnessModal from "@/components/common/FairnessModal";  // generic (Phase 8 refactor)
import { fireLegendaryBurst } from "@/lib/celebrations";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Segment colour per type — same accents as the rest of the app.
// Phase 11.1 — Wheel segments restricted to the 5-token gold-luxe palette:
// surface-2 (dark base), surface-3 (alt base), gold-500 (highlight),
// gold-bright (jackpot/top tier), --danger red (token_dust / loss risk).
const SEG_FILL = {
    ton_multi: "#13110C",          // --surface-2 (dark base)
    low_gift:  "#1C1810",          // --surface-3 (alt base)
    mid_gift:  "#13110C",          // --surface-2 (alternate band)
    high_gift: "#D4AF37",          // --gold-500 (highlight)
    jackpot:   "#FFD700",          // --gold-bright (top tier)
};
const SEG_STROKE = {
    ton_multi: "rgba(212,175,55,0.45)",
    low_gift:  "rgba(184,134,11,0.45)",
    mid_gift:  "rgba(212,175,55,0.55)",
    high_gift: "rgba(255,215,0,0.85)",
    jackpot:   "rgba(255,215,0,1.0)",
};
const SEG_LABEL_FILL = {
    ton_multi: "#FFEB99",          // gold-200
    low_gift:  "#FFEB99",
    mid_gift:  "#FFEB99",
    high_gift: "#0B0905",          // near-black on the gold-500 band
    jackpot:   "#0B0905",          // near-black on the gold-bright band
};

const VIEW = 320;       // SVG viewport (square)
const R_OUTER = 150;
const R_INNER = 50;     // Phase 11.2.1 — larger hub so labels live near the rim only
const CX = VIEW / 2;
const CY = VIEW / 2;
const SEG_COUNT = 24;
const SEG_DEG = 360 / SEG_COUNT;


function polarPoint(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx, cy, rInner, rOuter, startDeg, endDeg) {
    const [x1, y1] = polarPoint(cx, cy, rOuter, startDeg);
    const [x2, y2] = polarPoint(cx, cy, rOuter, endDeg);
    const [x3, y3] = polarPoint(cx, cy, rInner, endDeg);
    const [x4, y4] = polarPoint(cx, cy, rInner, startDeg);
    const large = (endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}
            L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
}


function fmtCountdown(targetIso) {
    if (!targetIso) return null;
    const ms = Math.max(0, new Date(targetIso).getTime() - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    if (h >= 1) return `${h}h ${m.toString().padStart(2, "0")}m`;
    if (m >= 1) return `${m}m ${s.toString().padStart(2, "0")}s`;
    return `${s}s`;
}


// ─── Page ───────────────────────────────────────────────────────────────────
export const WheelPage = ({ user, balance, refreshBalance }) => {
    const { t } = useTranslation();
    const [config, setConfig]   = useState(null);
    const [spinning, setSpinning] = useState(false);
    const [result, setResult]   = useState(null);
    const [rotation, setRotation] = useState(0);     // degrees, monotonically increasing
    const [history, setHistory] = useState([]);
    const [countdown, setCountdown] = useState(null);
    // Fix-A: Provably-Fair modal state. Holds the spin to verify (latest or chosen-from-history).
    const [fairnessOpen, setFairnessOpen] = useState(false);
    const [fairnessSpin, setFairnessSpin] = useState(null);

    // Initial config load (and refresh after each spin)
    const loadConfig = useCallback(async () => {
        try {
            const { data } = await http.get("/wheel/config");
            setConfig(data);
        } catch (e) {
            toast.error(e?.response?.data?.detail || t("wheel.toast.config_error"));
        }
    }, [t]);

    const loadHistory = useCallback(async () => {
        try {
            const { data } = await http.get("/wheel/history?limit=20");
            setHistory(data.rows || []);
        } catch { /* not fatal */ }
    }, []);

    useEffect(() => { loadConfig(); loadHistory(); }, [loadConfig, loadHistory]);

    // Live free-token countdown
    useEffect(() => {
        if (!config?.next_free_token_at) return undefined;
        const tick = () => setCountdown(fmtCountdown(config.next_free_token_at));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [config?.next_free_token_at]);

    // ─── Spin handler ──────────────────────────────────────────────────────
    const spin = async (useFreeToken) => {
        if (spinning || !config) return;
        // Validation guards (Polish §9)
        if (!useFreeToken && (balance ?? 0) < config.paid_spin_cost_ton) {
            notifyWarning();
            toast.error(t("wheel.validation.insufficient_balance"));
            return;
        }
        if (useFreeToken && (config.free_spin_tokens ?? 0) < 1) {
            notifyWarning();
            toast.error(t("wheel.validation.no_token"));
            return;
        }
        setSpinning(true); setResult(null);
        tapMedium(); sfx.play("chip_click", { volume: 0.75 });
        sfx.play("scroll_tick", { volume: 0.6 });
        try {
            const { data } = await http.post("/wheel/spin", { use_free_token: !!useFreeToken });
            // Compute final rotation: land segment_index under the pointer at 0°.
            // Pointer is at top (12 o'clock); segments are drawn starting at top
            // and going clockwise. So we need to rotate by `-segment_index × 15°`
            // modulo 360, plus 5-6 full extra turns for drama, plus a small
            // ±3° wobble for natural feel.
            const wobble = ((Math.random() * 6) - 3);
            const targetMod = -(data.segment_index * SEG_DEG) + (SEG_DEG / 2) + wobble;
            // Keep rotation increasing so framer-motion always animates forward.
            const fullTurns = 5 * 360;
            const next = rotation + fullTurns + ((targetMod - (rotation % 360)) + 720) % 360;
            setRotation(next);
            // Resolve result after the wheel's animation finishes.
            const animMs = PRM() ? 50 : 4200;
            setTimeout(async () => {
                setResult(data);
                sfx.play("case_lock_thunk", { volume: 0.7 });
                if (data.segment_type === "jackpot") {
                    tapHeavy(); notifySuccess();
                    sfx.play("confetti_burst", { volume: 0.85 });
                    sfx.play("success_bell", { volume: 0.7 });
                } else if (data.segment_type === "high_gift" || data.segment_type === "mid_gift") {
                    tapHeavy(); notifySuccess();
                    sfx.play("confetti_burst", { volume: 0.55 });
                    sfx.play("success_bell", { volume: 0.55 });
                } else if (data.segment_type === "low_gift") {
                    notifySuccess();
                    sfx.play("success_bell", { volume: 0.4 });
                    // Phase 11.1 — gift segments are mid-tier celebration
                    fireLegendaryBurst({ intensity: "normal" });
                } else if (data.segment_type === "jackpot" || data.segment_type === "top_gift") {
                    notifySuccess();
                    sfx.play("success_bell", { volume: 0.7 });
                    // Phase 11.1 — epic gold burst on jackpot / top-gift landing
                    fireLegendaryBurst({ intensity: "epic" });
                } else {
                    const m = config.segments.find(s => s.segment_index === data.segment_index)?.multiplier ?? 1.0;
                    if (m < 1.0) { notifyWarning(); sfx.play("loss_thud", { volume: 0.45 }); }
                    else if (m >= 10) {
                        notifySuccess();
                        fireLegendaryBurst({ intensity: "epic" });
                    } else { notifySuccess(); }
                }
                refreshBalance?.();
                await Promise.all([loadConfig(), loadHistory()]);
                setSpinning(false);
            }, animMs);
        } catch (e) {
            setSpinning(false);
            notifyError(); sfx.play("loss_thud", { volume: 0.4 });
            toast.error(e?.response?.data?.detail || t("wheel.toast.spin_error"));
        }
    };

    // ─── Derived ───────────────────────────────────────────────────────────
    const segments = config?.segments || [];
    const hasFreeToken = (config?.free_spin_tokens ?? 0) > 0;
    const paidCost = config?.paid_spin_cost_ton ?? 5;
    const insufficient = (balance ?? 0) < paidCost;
    const ctaDisabled = !config || spinning || (!hasFreeToken && insufficient);

    // Fix-A: open the fairness modal for a given spin (or the latest if omitted).
    const openFairness = useCallback((spin) => {
        const target = spin || result || history[0] || null;
        setFairnessSpin(target);
        setFairnessOpen(true);
        tapMedium();
        sfx.play("chip_click", { volume: 0.35 });
    }, [result, history]);

    // ─── Render ────────────────────────────────────────────────────────────
    return (
        <main
            data-testid="wheel-page"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            className="mx-auto px-3 sm:px-6 pt-4 pb-28 lg:pb-6 space-y-4 max-w-[430px] sm:max-w-[640px] lg:max-w-[1100px]"
        >
            {/* Hero banner (Polish §1) */}
            <header
                data-testid="wheel-hero"
                className="relative overflow-hidden rounded-3xl border border-white/10 -mx-1"
                style={{
                    backgroundImage: "url(/banners/wheel.png)",
                    backgroundSize: "auto 100%",
                    backgroundPosition: "right center",
                    backgroundRepeat: "no-repeat",
                    backgroundColor: "#0a0a14",
                    minHeight: 180,
                }}
            >
                <span aria-hidden className="absolute inset-0 pointer-events-none" style={{
                    background: "linear-gradient(90deg, rgba(10,10,20,0.88) 0%, rgba(10,10,20,0.45) 60%, rgba(10,10,20,0.05) 100%)",
                }} />
                <div className="relative flex items-start justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0 self-end">
                        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-bright font-bold flex items-center gap-1.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
                            <Disc3 className="w-3 h-3" /> {t("wheel.tag")}
                        </div>
                        <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-white mt-1 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                            {t("wheel.title")}
                        </h1>
                        <p className="text-[11px] sm:text-xs text-white/80 mt-1 max-w-[14rem] leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                            {t("wheel.subtitle")}
                        </p>
                    </div>
                </div>
            </header>

            {/* Provably-fair pill row (mirrors crash/roulette) */}
            <div className="flex items-center justify-between gap-2 px-1">
                <button
                    type="button"
                    onClick={() => openFairness(null)}
                    className="text-[10px] uppercase tracking-wider text-white/55 font-bold flex items-center gap-1 hover:text-white transition-colors rounded px-1 py-0.5 -ml-1 hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-gold-bright/40"
                    data-testid="wheel-provably-fair-pill"
                    aria-label={t("wheel.fair.aria.open")}
                >
                                    <Shield className="w-3 h-3" /> {t("wheel.provably_fair")}
                    <ChevronRight className="w-3 h-3 opacity-60" aria-hidden="true" />
                </button>
                {hasFreeToken ? (
                    <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold flex items-center gap-1">
                        <Ticket className="w-3 h-3" /> {t("wheel.free_token_available")}
                    </div>
                ) : (
                    <div data-testid="wheel-next-free-countdown" className="text-[10px] uppercase tracking-wider text-white/40 font-bold tabular-nums">
                        {t("wheel.next_free_in", { time: countdown ?? "—" })}
                    </div>
                )}
            </div>

            {/* Wheel section */}
            <section
                data-testid="wheel-stage"
                className="relative overflow-hidden rounded-3xl border border-gold-500/25 bg-[radial-gradient(circle_at_50%_45%,rgba(212,175,55,0.10),transparent_60%)] bg-surface-2 p-3 sm:p-6 flex flex-col items-center"
            >
                <div className="relative" style={{ width: "min(320px, 88vw)", maxWidth: 320 }}>
                    {/* Pointer at 12 o'clock — gold luxe */}
                    <div className="absolute left-1/2 -translate-x-1/2 -top-1 z-10 select-none pointer-events-none">
                        <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-gold-bright drop-shadow-[0_2px_6px_rgba(255,215,0,0.75)]" />
                    </div>
                    <motion.div
                        animate={{ rotate: rotation }}
                        transition={{
                            // Phase 11.2.3 — intentionally ignore
                            // prefers-reduced-motion for the wheel spin.
                            // On iOS Telegram WebView PRM is often forced on
                            // by system "Reduce Motion" settings, which used
                            // to set duration=0 and made the wheel
                            // "teleport" to its result without animating.
                            // The spin is the central game animation —
                            // skipping it kills the feature.  Other less
                            // critical animations still honor PRM.
                            duration: 4.2,
                            ease: [0.18, 0.78, 0.18, 1.0],
                        }}
                        style={{ transformOrigin: "50% 50%", willChange: "transform" }}
                    >
                        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-auto" aria-label={t("wheel.aria_wheel")}>
                            {segments.length === 0
                                ? (
                                    <circle cx={CX} cy={CY} r={R_OUTER} fill="rgba(255,255,255,0.04)" />
                                )
                                : segments.map((s) => {
                                    const start = s.segment_index * SEG_DEG;
                                    const end = start + SEG_DEG;
                                    const d = arcPath(CX, CY, R_INNER, R_OUTER, start, end);
                                    // Phase 11.2.1 — labels live near the OUTER rim,
                                    // not at the wedge midpoint, so they don't collide
                                    // near the hub.
                                    const [lx, ly] = polarPoint(CX, CY, R_OUTER - 22, start + SEG_DEG / 2);
                                    // Loss wedges (ton_multi with multiplier < 1) get
                                    // NO label — the dark red fill speaks for itself.
                                    const isLoss = s.segment_type === "ton_multi" && (s.multiplier ?? 1) < 1;
                                    const labelText = isLoss
                                        ? ""
                                        : s.segment_type === "ton_multi"
                                            ? `${s.multiplier}×`
                                            : s.segment_type === "jackpot"
                                                ? "JACK"
                                                : s.segment_type === "high_gift"
                                                    ? "HI"
                                                    : s.segment_type === "mid_gift"
                                                        ? "MID"
                                                        : "LOW";
                                    return (
                                        <g key={s.segment_index}>
                                            <path d={d} fill={SEG_FILL[s.segment_type]} stroke={SEG_STROKE[s.segment_type]} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                                            {labelText && (
                                                <text
                                                    x={lx} y={ly}
                                                    fill={SEG_LABEL_FILL[s.segment_type]}
                                                    fontSize="10" fontWeight="800"
                                                    textAnchor="middle" dominantBaseline="middle"
                                                    // Tangential orientation — label reads along the arc
                                                    // (perpendicular to the radius), so neighbour labels no
                                                    // longer collide near the hub.
                                                    transform={`rotate(${start + SEG_DEG / 2 + 90}, ${lx}, ${ly})`}
                                                    style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.85))" }}
                                                    pointerEvents="none"
                                                >
                                                    {labelText}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            {/* Inner hub — gold luxe */}
                            <circle cx={CX} cy={CY} r={R_INNER} fill="#0B0905" stroke="rgba(212,175,55,0.55)" strokeWidth="1.5" />
                            <circle cx={CX} cy={CY} r={R_INNER * 0.55} fill="url(#hubGlow)" />
                            <defs>
                                <radialGradient id="hubGlow">
                                    <stop offset="0%"  stopColor="rgba(255,215,0,0.75)" />
                                    <stop offset="100%" stopColor="rgba(255,215,0,0)" />
                                </radialGradient>
                            </defs>
                        </svg>
                    </motion.div>
                </div>

                {/* CTAs */}
                <div className="w-full mt-4 sm:mt-6 space-y-2">
                    {hasFreeToken ? (
                        <button
                            data-testid="wheel-free-spin-btn"
                            onClick={() => spin(true)}
                            disabled={ctaDisabled}
                            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-b from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_-6px_rgba(212,175,55,0.55)]"
                        >
                            <Ticket className="w-4 h-4" />
                            {spinning ? t("wheel.spinning") : t("wheel.free_spin")}
                        </button>
                    ) : insufficient ? (
                        <button
                            data-testid="wheel-deposit-cta"
                            onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("lydo:open-deposit")); }}
                            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide"
                        >
                            {t("wheel.deposit_cta")}
                        </button>
                    ) : (
                        <button
                            data-testid="wheel-paid-spin-btn"
                            onClick={() => spin(false)}
                            disabled={ctaDisabled}
                            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-b from-gold-300 via-gold-bright to-gold-500 hover:brightness-110 text-zinc-950 font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_-6px_rgba(255,215,0,0.55)]"
                        >
                            <Coins className="w-4 h-4" />
                            {spinning
                                ? t("wheel.spinning")
                                : t("wheel.paid_spin", { cost: formatTON(paidCost, 0) })}
                        </button>
                    )}
                    <div className="text-center text-[10px] uppercase tracking-wider text-white/40 font-bold">
                        {t("wheel.free_tokens_count", { n: config?.free_spin_tokens ?? 0 })}
                    </div>
                </div>
            </section>

            {/* Win modal */}
            <AnimatePresence>
                {result && (
                    <motion.div
                        data-testid="wheel-win-modal"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40 bg-black/65 flex items-end sm:items-center justify-center p-3"
                        onClick={() => setResult(null)}
                    >
                        <motion.div
                            initial={{ y: 32, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 32, scale: 0.95 }}
                            transition={{ type: "spring", damping: 22, stiffness: 220 }}
                            className="relative w-full max-w-md bg-cyber-surface border border-white/10 rounded-3xl p-5 overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <WheelResultBody result={result} segments={segments} t={t} onClose={() => setResult(null)} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Segment legend */}
            <section data-testid="wheel-legend" className="rounded-2xl border border-white/10 bg-cyber-surface/35 p-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                    <Sparkles className="w-3.5 h-3.5 text-white/40" />
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-bold">{t("wheel.legend_title")}</div>
                </div>
                {segments.length === 0 ? (
                    <SkeletonRows />
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {segments.map((s) => <LegendCard key={s.segment_index} s={s} t={t} />)}
                    </div>
                )}
            </section>

            {/* Spin history */}
            <section data-testid="wheel-history" className="rounded-2xl border border-white/10 bg-cyber-surface/35 p-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                    <History className="w-3.5 h-3.5 text-white/40" />
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-bold">{t("wheel.history_title")}</div>
                </div>
                {history.length === 0 ? (
                    <div className="rounded-xl border border-white/8 p-6 text-center">
                        <Disc3 className="mx-auto mb-2 w-6 h-6 text-white/30" />
                        <div className="font-medium text-white/80 text-sm">{t("wheel.empty_history_title")}</div>
                        <div className="text-[11px] text-white/50">{t("wheel.empty_history_sub")}</div>
                    </div>
                ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {history.map((h) => (
                            <div key={h.spin_id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/10">
                                <span className="text-[10px] uppercase tracking-wider font-bold text-white/45 tabular-nums w-12">
                                    #{h.segment_index}
                                </span>
                                <span className="flex-1 truncate text-white/80">
                                    {h.payout_type === "item"
                                        ? t("wheel.history.item_row", { slug: h.payout_item_slug })
                                        : t("wheel.history.ton_row", { amount: formatTON(h.payout_ton) })}
                                </span>
                                {h.used_free_token && (
                                    <span className="text-[9px] font-bold text-emerald-300 uppercase">
                                        {t("wheel.history.free")}
                                    </span>
                                )}
                                {/* Fix-A: truncated hash + verify link per row */}
                                {h.server_seed_hash && (
                                    <code
                                        className="hidden sm:inline text-[9px] font-mono text-white/40 tabular-nums"
                                        title={h.server_seed_hash}
                                        data-testid={`wheel-history-hash-${h.spin_id}`}
                                    >
                                        {h.server_seed_hash.slice(0, 6)}…{h.server_seed_hash.slice(-4)}
                                    </code>
                                )}
                                <button
                                    type="button"
                                    onClick={() => openFairness(h)}
                                    className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-gold-bright/85 hover:text-gold-bright transition-colors px-1.5 py-0.5 rounded hover:bg-gold-bright/10"
                                    data-testid={`wheel-history-verify-${h.spin_id}`}
                                    aria-label={t("wheel.fair.aria.verify_row")}
                                >
                                    <Shield className="w-2.5 h-2.5" aria-hidden="true" />
                                    {t("wheel.history.verify")}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
            {/* Fix-A + Phase 8 refactor: generic Provably-Fair modal */}
            <FairnessModal
                open={fairnessOpen}
                onClose={() => setFairnessOpen(false)}
                title="Verify this spin"
                subtitle="Recompute the segment from the server seed (revealed below) to confirm the wheel wasn't biased."
                fields={fairnessSpin ? [
                    { label: "Spin ID", value: fairnessSpin.spin_id, copyable: true },
                    { label: "Server seed hash (committed pre-spin)", value: fairnessSpin.server_seed_hash, copyable: true },
                    { label: "Client seed (nonce)", value: fairnessSpin.spin_id, copyable: true },
                    { label: "Segment index", value: String(fairnessSpin.segment_index ?? "—"), mono: true },
                    { label: "Spun at", value: fairnessSpin.spun_at ? new Date(fairnessSpin.spun_at).toLocaleString() : "—", mono: false },
                ] : []}
                verifyUrl={fairnessSpin ? `/wheel/spins/${fairnessSpin.spin_id}/verify` : null}
                parseVerify={(r) => ([
                    { label: "Hash matches commit",     ok: !!r.server_seed_hash_matches },
                    { label: "Segment recomputed OK",   ok: !!r.segment_index_matches },
                ])}
                revealedFields={(r) => ([
                    { label: "Server seed (revealed post-spin)", value: r.server_seed, copyable: true },
                ])}
            />
        </main>
    );
};


// ─── Sub-components ─────────────────────────────────────────────────────────
const SkeletonRows = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.03] border border-white/8 animate-pulse" />
        ))}
    </div>
);

const LegendCard = ({ s, t }) => {
    const isItem = s.segment_type !== "ton_multi";
    return (
        <div className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/10">
            {isItem ? (
                <div className="aspect-square relative">
                    <img
                        src={resolveImage(s.image_path)}
                        alt={s.item_name || s.item_slug}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                    />
                    <span
                        className="absolute top-1.5 left-1.5 text-[8px] font-extrabold tracking-widest uppercase px-1.5 py-0.5 rounded border"
                        style={{
                            color: RARITY_HEX[s.item_rarity || "common"],
                            borderColor: `${RARITY_HEX[s.item_rarity || "common"]}66`,
                            background: "rgba(0,0,0,0.55)",
                        }}
                    >
                        {t(`wheel.seg.${s.segment_type}`)}
                    </span>
                </div>
            ) : (
                <div className={`aspect-square relative flex items-center justify-center bg-gradient-to-br ${
                    s.multiplier >= 1 ? "from-gold-700/35 to-gold-900/25" : "from-zinc-800/55 to-zinc-900/65"
                }`}>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/55 absolute top-2 left-2">
                        {t("wheel.seg.ton_multi")}
                    </span>
                    <span className={`font-display text-3xl font-black tabular-nums ${
                        s.multiplier >= 1 ? "text-gold-bright" : "text-rose-300/85"
                    }`}>
                        {s.multiplier}×
                    </span>
                </div>
            )}
            <div className="px-2 py-1.5">
                <div className="font-semibold text-[11px] text-white/85 truncate">
                    {isItem ? (s.item_name || s.item_slug) : t("wheel.seg.ton_payout_n", { n: (s.multiplier * 5).toFixed(2) })}
                </div>
                {isItem && s.item_floor_ton > 0 && (
                    <div className="text-[10px] text-cyan-300 font-bold tabular-nums">
                        ≈ {formatTON(s.item_floor_ton)} TON
                    </div>
                )}
            </div>
        </div>
    );
};


const WheelResultBody = ({ result, segments, t, onClose }) => {
    const seg = segments.find((s) => s.segment_index === result.segment_index);
    const isItem = result.payout_type === "item";
    const big = ["jackpot", "high_gift", "mid_gift"].includes(result.segment_type);
    return (
        <>
            {big && (
                <div aria-hidden className="absolute -inset-4 pointer-events-none z-0"
                     style={{
                         background: "radial-gradient(closest-side, rgba(255,215,0,0.40), transparent 70%)",
                     }} />
            )}
            <div className="relative z-10">
                <div className="text-center">
                    <div className={`text-[10px] uppercase tracking-[0.32em] font-bold ${
                        result.segment_type === "jackpot" ? "text-gold-bright drop-shadow-[0_0_6px_rgba(255,215,0,0.6)]" :
                        result.segment_type === "high_gift" ? "text-gold-bright" :
                        result.segment_type === "mid_gift" ? "text-gold-300" :
                        result.segment_type === "low_gift" ? "text-emerald-300" :
                        "text-gold-200"
                    }`}>
                        {t(`wheel.result_tag.${result.segment_type}`)}
                    </div>
                    {isItem && seg ? (
                        <>
                            <div className="mx-auto mt-3 w-32 rounded-2xl overflow-hidden bg-white/5 border border-white/10">
                                <div className="aspect-square relative">
                                    <img
                                        src={resolveImage(seg.image_path)}
                                        alt={seg.item_name || seg.item_slug}
                                        className="absolute inset-0 w-full h-full object-cover"
                                    />
                                </div>
                                <div className="px-2 py-1.5">
                                    <div className="font-semibold text-xs truncate">{seg.item_name || seg.item_slug}</div>
                                    <div className="text-[11px] text-gold-bright font-bold tabular-nums">
                                        ≈ {formatTON(seg.item_floor_ton)} TON
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="mt-3">
                            <div className="font-display text-5xl font-black tabular-nums text-gold-bright drop-shadow-[0_0_10px_rgba(255,215,0,0.55)]">
                                <RollingNumber value={result.payout_ton} format={(n) => formatTON(n)} />
                                <span className="text-base text-white/55 ml-1">TON</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="mt-4 flex gap-2">
                    <button
                        data-testid="wheel-result-close"
                        onClick={onClose}
                        className="flex-1 inline-flex items-center justify-center gap-1 bg-white/5 border border-white/15 hover:bg-white/10 transition text-white font-display font-bold text-xs rounded-xl py-2.5 uppercase tracking-wide"
                    >
                        {t("wheel.result_close")} <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </>
    );
};


export default WheelPage;
