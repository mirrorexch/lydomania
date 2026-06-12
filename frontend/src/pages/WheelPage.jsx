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
import FairnessModal from "@/components/common/FairnessModal";  // generic (Phase 8 refactor)
import { fireLegendaryBurst } from "@/lib/celebrations";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Segment colour per type — same accents as the rest of the app.
// Phase 11.3 — premium palette overhaul. Five distinct tiers visually:
//   • ton_multi loss  (×0.5 / ×0.75) — near-black "dud" wedge
//   • ton_multi neutral/win (≥ ×1.0) — warm gold-tinted base
//   • low_gift        — deep navy with cyan accent (gift, but small)
//   • mid_gift        — royal violet (mid-tier gift)
//   • high_gift       — vivid magenta/pink (rare gift)
//   • jackpot         — pure gold-bright with strong glow
// Loss wedges are intentionally darkest so a paying player can SEE the
// stripe of "bad" segments at a glance — informed expectations build
// trust even when the math is against you.
const SEG_FILL = {
    ton_multi:      "#13110C",           // base — overridden below for win/loss
    ton_multi_loss: "#0B0905",           // near-black
    ton_multi_win:  "#2A2009",           // warm gold-tint
    low_gift:       "#0E1B2E",           // deep navy
    mid_gift:       "#1F0F3A",           // royal violet
    high_gift:      "#3A0E2A",           // dark magenta
    jackpot:        "#5C4406",           // gold-bright base (rim glows over it)
};
const SEG_STROKE = {
    ton_multi:      "rgba(212,175,55,0.30)",
    ton_multi_loss: "rgba(120,80,30,0.35)",
    ton_multi_win:  "rgba(255,215,0,0.55)",
    low_gift:       "rgba(56,189,248,0.55)",   // cyan rim
    mid_gift:       "rgba(167,139,250,0.65)",  // violet rim
    high_gift:      "rgba(244,114,182,0.85)",  // pink rim
    jackpot:        "rgba(255,215,0,1.0)",
};
const SEG_LABEL_FILL = {
    ton_multi:      "#FFEB99",
    ton_multi_loss: "#9A5C4A",            // muted rose — clearly a "loss" hue
    ton_multi_win:  "#FFD700",            // gold-bright
    low_gift:       "#7DD3FC",            // cyan
    mid_gift:       "#C4B5FD",            // violet
    high_gift:      "#F9A8D4",            // pink
    jackpot:        "#0B0905",            // near-black on gold-bright
};
// Resolve the effective tier key for a segment (splits ton_multi by win/loss).
function tierKey(s) {
    if (s.segment_type !== "ton_multi") return s.segment_type;
    return (s.multiplier ?? 1) < 1 ? "ton_multi_loss" : "ton_multi_win";
}

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
            // Phase 11.2.10 — wobble REMOVED.
            //   Was: `const wobble = ((Math.random() * 6) - 3);` and
            //         `+ wobble` in the target rotation.
            //   With SEG_DEG=15° (each segment is only 15° wide), a ±3°
            //   wobble could land the pointer visually OVER the neighbour
            //   segment's outer arc — so users saw "JACK" or "MID" under
            //   the needle while the backend honestly returned the
            //   adjacent ton_multi segment (e.g. ×0.5 = 2.5 TON).
            //   The win modal then showed 2.5 TON next to a visible "JACK"
            //   label, looking like a rigged outcome. Removing wobble
            //   makes the pointer land EXACTLY in the centre of the
            //   resolved segment — single source of truth, no perception bug.
            const wobble = 0;
            // Phase 11.3.1 — OFF-BY-ONE in the rotation formula fixed.
            //   Previously: `-(i * SEG_DEG) + (SEG_DEG / 2)` — the `+ SEG_DEG/2`
            //   was the wrong sign. Each <path> wedge is drawn from angle
            //   `i*SEG_DEG` to `(i+1)*SEG_DEG` (center at `i*SEG_DEG + 7.5°`).
            //   To put the wedge's CENTER under the pointer at the 12 o'clock
            //   position (0°), the wheel must rotate by `-(i*SEG_DEG + 7.5°)`,
            //   NOT `-(i*SEG_DEG) + 7.5°`. The old formula was a half-segment
            //   off — pointer always landed on the COUNTER-CLOCKWISE neighbour
            //   (i-1) of the actual API-returned segment. Live test confirmed:
            //   api_segment_index=0 → visual_idx=23 (off by exactly one wedge
            //   in the CCW direction, == half-segment offset under pointer).
            //   After this flip the pointer lands inside wedge i (not on its
            //   23-side border) for every spin.
            const targetMod = -((data.segment_index + 0.5) * SEG_DEG) + wobble;
            // Keep rotation increasing so framer-motion always animates forward.
            const fullTurns = 5 * 360;
            const next = rotation + fullTurns + ((targetMod - (rotation % 360)) + 720) % 360;
            setRotation(next);
            // Resolve result after the wheel's animation finishes.
            // Phase 11.2.4 — intentionally ignore prefers-reduced-motion here:
            // the rotation itself runs for 4200ms (we forced it in Phase
            // 11.2.3 because iOS Telegram WebView often has Reduce Motion ON),
            // so animMs MUST match the rotation duration. If we leave PRM()
            // branch at 50ms, the win-modal pops up BEFORE the wheel finishes
            // spinning — which is exactly what the user saw in production.
            const animMs = 4200;
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
            className="v-wrap"
        >
            {/* Hero */}
            <header data-testid="wheel-hero" className="v-gamehead" data-game="wheel">
                <div className="v-eyebrow"><Disc3 className="w-3 h-3" /> {t("wheel.tag")}</div>
                <h1 className="v-disp">{t("wheel.title")}</h1>
                <p>{t("wheel.subtitle")}</p>
                <div className="flex items-center justify-between gap-2 mt-3">
                    <button
                        type="button"
                        onClick={() => openFairness(null)}
                        className="pf"
                        style={{ background: "none", border: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: "var(--v-muted)", font: "600 9px 'Inter'", letterSpacing: ".16em", textTransform: "uppercase" }}
                        data-testid="wheel-provably-fair-pill"
                        aria-label={t("wheel.fair.aria.open")}
                    >
                        <Shield className="w-3 h-3" /> {t("wheel.provably_fair")}
                        <ChevronRight className="w-3 h-3 opacity-70" aria-hidden="true" />
                    </button>
                    {hasFreeToken ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--v-emerald)", font: "700 9px 'Inter'", letterSpacing: ".1em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 999, background: "rgba(47,191,143,.1)", border: "1px solid rgba(47,191,143,.3)" }}>
                            <Ticket className="w-3 h-3" /> {t("wheel.free_token_available")}
                        </div>
                    ) : (
                        <div
                            data-testid="wheel-next-free-countdown"
                            style={{ color: "var(--v-muted)", font: "600 9px 'JetBrains Mono'", letterSpacing: ".08em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 999, background: "var(--v-surface-2)", border: "1px solid var(--v-line-soft)" }}
                        >
                            {t("wheel.next_free_in", { time: countdown ?? "—" })}
                        </div>
                    )}
                </div>
            </header>

            {/* Wheel section */}
            <section
                data-testid="wheel-stage"
                className="v-stage flex flex-col items-center"
                style={{ padding: "18px 14px", marginTop: 14 }}
            >
                <div className="relative" style={{ width: "min(320px, 88vw)", maxWidth: 320 }}>
                    {/* Pointer at 12 o'clock — Phase 11.3 premium needle.
                        Wider base (16px) + longer tip (24px) + dual gold
                        drop-shadow for stronger visual anchor. */}
                    <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 z-10 select-none pointer-events-none">
                        <div
                            className="w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[24px] border-t-gold-bright"
                            style={{
                                filter: "drop-shadow(0 2px 4px rgba(255,215,0,0.85)) drop-shadow(0 0 12px rgba(255,215,0,0.45))",
                            }}
                        />
                        <div className="w-2.5 h-2.5 rounded-full bg-gold-bright mx-auto -mt-1 shadow-[0_0_8px_rgba(255,215,0,0.85)]" />
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
                            <defs>
                                <radialGradient id="hubGlow">
                                    <stop offset="0%"  stopColor="rgba(255,215,0,0.85)" />
                                    <stop offset="100%" stopColor="rgba(255,215,0,0)" />
                                </radialGradient>
                                <radialGradient id="rimGlow" cx="50%" cy="50%" r="50%">
                                    <stop offset="92%"  stopColor="rgba(255,215,0,0)" />
                                    <stop offset="100%" stopColor="rgba(255,215,0,0.55)" />
                                </radialGradient>
                                {/* Phase 11.3 — soft inner shadow so each segment looks recessed. */}
                                <filter id="segInnerShadow" x="-10%" y="-10%" width="120%" height="120%">
                                    <feGaussianBlur stdDeviation="1.2" />
                                </filter>
                            </defs>
                            {segments.length === 0
                                ? (
                                    <circle cx={CX} cy={CY} r={R_OUTER} fill="rgba(255,255,255,0.04)" />
                                )
                                : segments.map((s) => {
                                    const start = s.segment_index * SEG_DEG;
                                    const end = start + SEG_DEG;
                                    const d = arcPath(CX, CY, R_INNER, R_OUTER, start, end);
                                    const tk = tierKey(s);
                                    const isItem = s.segment_type !== "ton_multi";
                                    // Phase 11.3 — for item segments, render the prize
                                    // icon INSIDE the wedge (near the outer rim), and
                                    // push the small tier-tag label closer to the hub
                                    // so it doesn't collide with the icon.
                                    const labelRadius = isItem ? (R_INNER + 14) : (R_OUTER - 22);
                                    const [lx, ly] = polarPoint(CX, CY, labelRadius, start + SEG_DEG / 2);
                                    // For ton_multi we ALWAYS show the multiplier
                                    // (Phase 11.3 change — was hidden for losses,
                                    // but post-wobble-fix users want to know that
                                    // the wedge under their pointer was indeed
                                    // a ×0.5/×0.75, so show the value with a
                                    // visibly "loss" tint instead of hiding it).
                                    const labelText = s.segment_type === "ton_multi"
                                        ? `${s.multiplier}×`
                                        : s.segment_type === "jackpot"
                                            ? "JACK"
                                            : s.segment_type === "high_gift"
                                                ? "HI"
                                                : s.segment_type === "mid_gift"
                                                    ? "MID"
                                                    : "LOW";
                                    // Icon position (item segments only) — outer band.
                                    const [ix, iy] = polarPoint(CX, CY, R_OUTER - 28, start + SEG_DEG / 2);
                                    const iconRotate = start + SEG_DEG / 2;          // straighten icon along radius
                                    const iconSize = 22;
                                    const itemIcon = isItem && s.image_path ? resolveImage(s.image_path) : null;
                                    return (
                                        <g key={s.segment_index}>
                                            <path
                                                d={d}
                                                fill={SEG_FILL[tk] || SEG_FILL[s.segment_type]}
                                                stroke={SEG_STROKE[tk] || SEG_STROKE[s.segment_type]}
                                                strokeWidth="1.25" vectorEffect="non-scaling-stroke"
                                            />
                                            {itemIcon && (
                                                <g transform={`rotate(${iconRotate}, ${ix}, ${iy})`}>
                                                    <image
                                                        href={itemIcon}
                                                        x={ix - iconSize/2} y={iy - iconSize/2}
                                                        width={iconSize} height={iconSize}
                                                        preserveAspectRatio="xMidYMid meet"
                                                        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85))" }}
                                                    />
                                                </g>
                                            )}
                                            {labelText && (
                                                <text
                                                    x={lx} y={ly}
                                                    fill={SEG_LABEL_FILL[tk] || SEG_LABEL_FILL[s.segment_type]}
                                                    fontSize={isItem ? "8" : "10"} fontWeight="800"
                                                    textAnchor="middle" dominantBaseline="middle"
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
                            {/* Phase 11.3 — gold outer rim + inner hub with crown emblem */}
                            <circle cx={CX} cy={CY} r={R_OUTER + 2} fill="none" stroke="url(#rimGlow)" strokeWidth="6" />
                            <circle cx={CX} cy={CY} r={R_OUTER} fill="none" stroke="#D4AF37" strokeWidth="2" />
                            <circle cx={CX} cy={CY} r={R_INNER} fill="#0B0905" stroke="#D4AF37" strokeWidth="2" />
                            <circle cx={CX} cy={CY} r={R_INNER * 0.65} fill="url(#hubGlow)" />
                            {/* Crown glyph at the centre — pure SVG, no font dep */}
                            <g transform={`translate(${CX - 13}, ${CY - 9})`} opacity="0.95">
                                <path
                                    d="M 2 16 L 2 8 L 7 12 L 13 4 L 19 12 L 24 8 L 24 16 Z M 2 18 L 24 18 L 24 20 L 2 20 Z"
                                    fill="#FFD700"
                                    stroke="#0B0905"
                                    strokeWidth="0.5"
                                    style={{ filter: "drop-shadow(0 0 4px rgba(255,215,0,0.55))" }}
                                />
                            </g>
                        </svg>
                    </motion.div>
                </div>

                {/* CTAs */}
                <div className="w-full mt-4 sm:mt-6 space-y-2">
                    {hasFreeToken ? (
                        <button data-testid="wheel-free-spin-btn" onClick={() => spin(true)} disabled={ctaDisabled} className="v-cta v-wide">
                            <Ticket className="w-4 h-4" />
                            {spinning ? t("wheel.spinning") : t("wheel.free_spin")}
                        </button>
                    ) : insufficient ? (
                        <button data-testid="wheel-deposit-cta" className="v-cta v-wide"
                            onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("lydo:open-deposit")); }}>
                            {t("wheel.deposit_cta")}
                        </button>
                    ) : (
                        <button data-testid="wheel-paid-spin-btn" onClick={() => spin(false)} disabled={ctaDisabled} className="v-cta v-wide">
                            <Coins className="w-4 h-4" />
                            {spinning
                                ? t("wheel.spinning")
                                : t("wheel.paid_spin", { cost: formatTON(paidCost, 0) })}
                        </button>
                    )}
                    <div className="text-center" style={{ font: "700 10px 'Inter'", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--v-muted-2)" }}>
                        {t("wheel.free_tokens_count", { n: config?.free_spin_tokens ?? 0 })}
                    </div>
                </div>
            </section>

            {/* Win modal */}
            {/* Phase 11.2.9 — fix:
                  Previously this modal used `z-40`, which equals the z-index
                  of <BottomNav>. With equal stacking, BottomNav (rendered
                  later in the DOM tree via AppShell) painted ON TOP of the
                  win panel, hiding the Claim/Close button. On <sm the panel
                  also docked to the bottom (`items-end`), worsening overlap.
                  Fixes applied:
                    • z-[60] (above BottomNav z-40, matches WithdrawModal
                      convention used elsewhere in the app)
                    • bottom padding accounts for safe-area + BottomNav height
                      (~88px) so even with `items-end` on mobile the panel
                      sits CLEARLY above the nav strip and the Close button
                      is fully tappable
                    • backdrop click NO LONGER dismisses — Claim is a real
                      transaction and the user must press the explicit
                      button (was: onClick → setResult(null), removed)
                    • backdrop visually upgraded to bg-black/70 + blur to
                      match the rest of the app's modal language. */}
            <AnimatePresence>
                {result && (
                    <motion.div
                        data-testid="wheel-win-modal"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 pb-[calc(env(safe-area-inset-bottom,0px)+88px)] sm:pb-3"
                    >
                        <motion.div
                            initial={{ y: 32, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 32, scale: 0.95 }}
                            transition={{ type: "spring", damping: 22, stiffness: 220 }}
                            className="v-card relative w-full max-w-md rounded-3xl p-5 overflow-hidden"
                            style={{ borderColor: "var(--v-line)" }}
                        >
                            <WheelResultBody result={result} segments={segments} t={t} onClose={() => setResult(null)} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Segment legend */}
            <section data-testid="wheel-legend" className="v-feed">
                <div className="hd"><Sparkles className="w-3.5 h-3.5" /> {t("wheel.legend_title")}</div>
                {segments.length === 0 ? (
                    <SkeletonRows />
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {segments.map((s) => <LegendCard key={s.segment_index} s={s} t={t} />)}
                    </div>
                )}
            </section>

            {/* Spin history */}
            <section data-testid="wheel-history" className="v-feed">
                <div className="hd"><History className="w-3.5 h-3.5" /> {t("wheel.history_title")}</div>
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
                <div className="aspect-square relative bg-[#0A0A0A]">
                    <img
                        src={resolveImage(s.image_path)}
                        alt={s.item_name || s.item_slug}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                    />
                    <span
                        className="absolute top-1.5 left-1.5 z-10 pointer-events-none text-[8px] font-extrabold tracking-widest uppercase px-1.5 py-0.5 rounded border"
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
