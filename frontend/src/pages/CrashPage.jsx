import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Rocket, Shield, Zap, Users, AlertTriangle, TrendingUp, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { openCrashSocket } from "@/lib/crashWs";
import { RollingNumber } from "@/components/RollingNumber";
import {
    tapMedium, tapHeavy, notifySuccess, notifyError, notifyWarning, selectionChanged,
} from "@/lib/haptics";
import { fireLegendaryBurst } from "@/lib/celebrations";


// Polish · honour prefers-reduced-motion globally on this page.
const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


// ─── Local utilities ────────────────────────────────────────────────────────
function multiplierAt(elapsedSec) {
    if (elapsedSec <= 0) return 1.0;
    const k = Math.log(2) / 7;             // mirrors backend GROWTH_K
    return Math.exp(k * elapsedSec);
}

function tierClass(x) {
    if (x < 1.5)  return "text-rose-400";
    if (x < 5)    return "text-amber-300";
    if (x < 25)   return "text-emerald-300";
    return "text-yellow-300";
}
function tierBg(x) {
    if (x < 1.5)  return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    if (x < 5)    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    if (x < 25)   return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
}


// ─── Hooks ──────────────────────────────────────────────────────────────────
function useCrashSocket(onMessage) {
    const ref = useRef(null);
    useEffect(() => {
        const token = localStorage.getItem("auth_token");
        if (!token) return;
        const s = openCrashSocket({ token, onMessage });
        ref.current = s;
        return () => s.close();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ref;
}


// ─── Main page ──────────────────────────────────────────────────────────────
export const CrashPage = ({ user, balance, refreshBalance }) => {
    const { t } = useTranslation();
    const [state, setState] = useState(null);        // server snapshot
    // Phase 11.2.1 hot-fix: `liveX` is now THROTTLED to ~6 Hz so the cashout
    // button label updates without forcing a global re-render every frame.
    // The big multiplier number is mutated DIRECTLY in the DOM via ref
    // (multiplierDomRef) at 60 Hz without going through React state.
    const [liveX, setLiveX] = useState(1.0);
    const [history, setHistory] = useState([]);       // last 30 multipliers
    const [bets, setBets] = useState([]);             // current-round bet feed
    const [myBet, setMyBet] = useState(null);         // my placed bet (if any)
    const [betAmount, setBetAmount] = useState(1.0);
    const [autoX, setAutoX] = useState("");
    const [placing, setPlacing] = useState(false);
    const [cashingOut, setCashingOut] = useState(false);
    const phase = state?.phase || "loading";
    const myBetRef = useRef(myBet); myBetRef.current = myBet;
    const lastTickRef = useRef({ x: 1.0, t: 0 });     // for client interpolation
    // Hot-fix refs
    const liveXRef = useRef(1.0);                     // high-precision multiplier (60 Hz)
    const multiplierDomRef = useRef(null);            // DOM node for direct textContent mutation
    const liveXThrottleRef = useRef(0);               // ms timestamp of last React setLiveX
    // Phase 11.2.3 — mobile WebView safety nets:
    //  - rafIdRef: lives across renders so cleanup can cancel the actual live RAF
    //    even if useEffect re-runs for ANY reason (closure-stale variable bug
    //    that hit Telegram iOS/Android WebView).
    //  - phaseRef: synced from `phase` state AND from WS `case "phase"` BEFORE
    //    setState batches, so the RAF step() can self-terminate even if React
    //    state batch is delayed in WebView.
    //  - roundStartRef: timestamp of the current running round, used by the
    //    90-second watchdog that force-stops the loop if no `phase=crashed`
    //    arrives (mobile WS occasionally drops messages).
    const rafIdRef = useRef(null);
    const phaseRef = useRef("loading");
    const roundStartRef = useRef(0);

    // Mutates the DOM directly every frame; throttles setLiveX state to 6 Hz.
    const writeMultiplier = useCallback((x) => {
        liveXRef.current = x;
        const node = multiplierDomRef.current;
        if (node) {
            node.textContent = x.toFixed(2) + "×";
            const tier = x < 1.5 ? "low" : x < 5 ? "mid" : x < 25 ? "hi" : "epic";
            if (node.dataset.tier !== tier) node.dataset.tier = tier;
        }
        const now = performance.now();
        if (now - liveXThrottleRef.current > 150) {
            liveXThrottleRef.current = now;
            setLiveX(x);
        }
    }, []);

    // Reset per-round local state on phase change
    const resetForNewRound = useCallback(() => {
        setBets([]); setMyBet(null);
        liveXRef.current = 1.0;
        liveXThrottleRef.current = 0;
        setLiveX(1.0);
        if (multiplierDomRef.current) {
            multiplierDomRef.current.textContent = "1.00×";
            multiplierDomRef.current.dataset.tier = "low";
        }
        lastTickRef.current = { x: 1.0, t: performance.now() };
    }, []);

    const onMsg = useCallback((msg) => {
        switch (msg.type) {
            case "state":
                setState(msg);
                setHistory(msg.recent_results || []);
                if (msg.phase === "running") {
                    const x = msg.live_multiplier || 1.0;
                    liveXRef.current = x;
                    setLiveX(x);
                    if (multiplierDomRef.current) {
                        multiplierDomRef.current.textContent = x.toFixed(2) + "×";
                    }
                } else {
                    resetForNewRound();
                }
                break;
            case "phase":
                // Phase 11.2.3 — sync phaseRef BEFORE setState batches so the
                // RAF closure can self-terminate even if React state batch is
                // delayed in mobile WebView. Also dev log for WebView Inspector.
                phaseRef.current = msg.phase;
                // eslint-disable-next-line no-console
                console.warn("[crash] WS phase →", msg.phase, "round_id=", msg.round_id || "—");
                setState((prev) => ({ ...(prev || {}), ...msg }));
                if (msg.phase === "betting") {
                    resetForNewRound();
                } else if (msg.phase === "running") {
                    lastTickRef.current = { x: 1.0, t: performance.now() };
                    roundStartRef.current = performance.now();
                    liveXRef.current = 1.0;
                    setLiveX(1.0);
                    if (multiplierDomRef.current) {
                        multiplierDomRef.current.textContent = "1.00×";
                        multiplierDomRef.current.dataset.tier = "low";
                    }
                    sfx.play("rising_hum", { volume: 0.45 });
                } else if (msg.phase === "crashed") {
                    // Force-stop RAF immediately, even before React batches.
                    if (rafIdRef.current != null) {
                        cancelAnimationFrame(rafIdRef.current);
                        rafIdRef.current = null;
                    }
                    const x = Number(msg.crash_multiplier || 1.0);
                    liveXRef.current = x;
                    setLiveX(x);   // immediate final value (the crashed screen needs it)
                    if (multiplierDomRef.current) {
                        multiplierDomRef.current.textContent = x.toFixed(2) + "×";
                    }
                    sfx.play("explosion_thud", { volume: 0.85 });
                    setHistory((prev) => [{ round_id: msg.round_id, crash_multiplier: x, ended_at: new Date().toISOString() }, ...prev].slice(0, 30));
                    // If user had a placed bet that never cashed out → lost
                    const me = myBetRef.current;
                    if (me && me.status === "placed") {
                        notifyError();
                        toast.error(t("crash.toast.lost", { amount: formatTON(me.amount_ton) }));
                        setMyBet({ ...me, status: "lost" });
                    }
                }
                break;
            case "tick":
                lastTickRef.current = { x: msg.multiplier, t: performance.now() };
                writeMultiplier(msg.multiplier);    // throttled state + direct DOM
                break;
            case "new_bet":
                setBets((prev) => [{
                    bet_id: msg.bet_id,
                    user_id: null,
                    username: msg.username,
                    photo_url: msg.photo_url,
                    amount_ton: msg.amount_ton,
                    auto_cashout_x: msg.auto_cashout_x,
                    cashed_at_x: null,
                    payout_ton: 0,
                    status: "placed",
                }, ...prev].slice(0, 50));
                break;
            case "cashout": {
                setBets((prev) => prev.map((b) =>
                    b.bet_id === msg.bet_id
                        ? { ...b, cashed_at_x: msg.cashed_at_x, payout_ton: msg.payout_ton, status: "won" }
                        : b,
                ));
                const me = myBetRef.current;
                if (me && me.bet_id === msg.bet_id) {
                    setMyBet({ ...me, cashed_at_x: msg.cashed_at_x, payout_ton: msg.payout_ton, status: "won" });
                    // Phase 11.1 — gold burst on big cashouts (≥10× normal, ≥50× epic)
                    const mx = Number(msg.cashed_at_x) || 0;
                    if (mx >= 50)      fireLegendaryBurst({ intensity: "epic" });
                    else if (mx >= 10) fireLegendaryBurst({ intensity: "normal" });
                    if (msg.auto) {
                        tapHeavy(); notifySuccess();
                        toast.success(t("crash.toast.auto_cashout", {
                            x: msg.cashed_at_x.toFixed(2), payout: formatTON(msg.payout_ton),
                        }));
                    }
                    refreshBalance?.();
                }
                break;
            }
            default: break;
        }
    }, [resetForNewRound, refreshBalance, t, writeMultiplier]);

    useCrashSocket(onMsg);

    // Initial state fetch (in case WS doesn't return state fast enough)
    useEffect(() => {
        http.get("/crash/state").then(({ data }) => {
            if (!state) {
                setState(data);
                setHistory(data.recent_results || []);
            }
        }).catch(() => {});
        http.get("/crash/history?limit=30").then(({ data }) => {
            if (data.rows?.length) {
                setHistory(data.rows.map((r) => ({
                    round_id: r.round_id,
                    crash_multiplier: r.crash_multiplier_revealed,
                    ended_at: r.ended_at,
                })));
            }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Phase 11.2.3 — keep phaseRef in sync with the React `phase` state so the
    // RAF step() (which reads only refs, never state) sees the latest phase
    // even when the React state batch is delayed by mobile WebView.  Also
    // logs every phase transition for debugging via Telegram WebView
    // Inspector / Eruda overlay.
    useEffect(() => {
        phaseRef.current = phase;
        // eslint-disable-next-line no-console
        console.warn("[crash] phase state →", phase);
    }, [phase]);

    // Phase 11.2.1 / 11.2.3 / 11.2.4 — Client-side interpolation between
    // server ticks. The RAF loop NEVER calls setState directly: it mutates
    // the multiplier DOM node via ref (writeMultiplier) so React doesn't
    // re-render at 60 Hz.  setLiveX is throttled to ~6 Hz inside
    // writeMultiplier so the cashout button label still updates smoothly.
    //
    // Phase 11.2.3 hardening for Telegram iOS/Android WebView:
    //   1. rafIdRef.current — cancel via ref (not local var) so cleanup
    //      reliably kills the live loop even if useEffect re-runs.
    //   2. phaseRef safety guard inside step() — self-terminate the loop
    //      if phase changed under us.
    //   3. Watchdog — force-stop if no `phase=crashed` arrives
    //      (mobile WS occasionally drops messages).
    //
    // Phase 11.2.4 additional safeguards (the previous 90-second watchdog
    // was too lenient and let the multiplier balloon to 4900× when the WS
    // froze in the background on iOS Telegram WebView):
    //   4. STALE-TICK FREEZE — if no `tick` from server in >3s, freeze
    //      writeMultiplier on the last known value (no extrapolation).
    //   5. PREDICTED CLAMP — never extrapolate higher than 2× the last
    //      server-acknowledged multiplier, even if the local clock thinks
    //      we've been running for ages.
    //   6. Watchdog tightened from 90s → 15s — real rounds rarely exceed
    //      ~30s and never 60s in production.
    useEffect(() => {
        if (phase !== "running") {
            // Idempotent cleanup if we ever land here with a live RAF.
            if (rafIdRef.current != null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            return undefined;
        }
        if (roundStartRef.current === 0) {
            roundStartRef.current = performance.now();
        }
        const MAX_ROUND_MS = 15_000;            // Phase 11.2.4: was 90_000
        const STALE_TICK_MS = 3_000;            // Phase 11.2.4: freeze threshold
        const MAX_PREDICT_FACTOR = 2.0;         // Phase 11.2.4: predicted ≤ 2× last server tick
        let lastStaleWarnAt = 0;
        const step = () => {
            // Guard 1 — phase changed under us.
            if (phaseRef.current !== "running") {
                rafIdRef.current = null;
                return;
            }
            // Guard 2 — watchdog (15s).
            const elapsedMs = performance.now() - roundStartRef.current;
            if (elapsedMs > MAX_ROUND_MS) {
                // eslint-disable-next-line no-console
                console.warn("[crash] watchdog stopping RAF after", Math.round(elapsedMs), "ms — no phase=crashed received");
                rafIdRef.current = null;
                phaseRef.current = "crashed";
                setState((prev) => ({ ...(prev || {}), phase: "crashed" }));
                return;
            }
            // Guard 3 — STALE-TICK FREEZE.  If server hasn't sent a `tick`
            // in >3 seconds, the WS is frozen (background tab / network
            // hiccup).  Don't extrapolate; just keep painting the last
            // known value and wait for ticks to resume.
            const last = lastTickRef.current;
            const sinceTick = performance.now() - last.t;
            if (sinceTick > STALE_TICK_MS) {
                if (performance.now() - lastStaleWarnAt > 1000) {
                    // eslint-disable-next-line no-console
                    console.warn("[crash] stale tick — freeze at", last.x.toFixed(2), "× for", Math.round(sinceTick), "ms");
                    lastStaleWarnAt = performance.now();
                }
                rafIdRef.current = requestAnimationFrame(step);
                return;
            }
            const dt = sinceTick / 1000;
            // Predict using backend curve so we don't drift.
            const baseElapsed = Math.log(last.x) / (Math.log(2) / 7);
            let predicted = multiplierAt(baseElapsed + dt);
            // Guard 4 — PREDICTED CLAMP.  Never go beyond 2× the last
            // server-acknowledged multiplier within a single tick window
            // (we should get a fresh tick every 100ms; if not, see Guard 3).
            const cap = last.x * MAX_PREDICT_FACTOR;
            if (predicted > cap) {
                // eslint-disable-next-line no-console
                console.warn("[crash] predict clamp", predicted.toFixed(2), "→", cap.toFixed(2), "(last server", last.x.toFixed(2), ")");
                predicted = cap;
            }
            writeMultiplier(predicted);
            rafIdRef.current = requestAnimationFrame(step);
        };
        rafIdRef.current = requestAnimationFrame(step);
        return () => {
            if (rafIdRef.current != null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
        // writeMultiplier intentionally omitted — useCallback([]) stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // ── Actions ────────────────────────────────────────────────────────────
    const placeBet = async () => {
        if (placing) return;
        if (phase !== "betting") {
            notifyWarning();
            toast.error(t("crash.toast.not_betting"));
            return;
        }
        if (myBet && myBet.round_id === state?.round_id) {
            toast.error(t("crash.toast.already_bet")); return;
        }
        setPlacing(true);
        tapMedium(); sfx.play("chip_click", { volume: 0.7 });
        try {
            const auto = autoX ? Number(autoX) : null;
            const { data } = await http.post("/crash/bet", {
                amount_ton: Number(betAmount), auto_cashout_x: auto,
            });
            setMyBet({
                bet_id: data.bet_id,
                round_id: data.round_id,
                amount_ton: data.amount_ton,
                auto_cashout_x: data.auto_cashout_x,
                cashed_at_x: null,
                payout_ton: 0,
                status: "placed",
            });
            refreshBalance?.();
            notifySuccess();
            toast.success(t("crash.toast.bet_ok", { amount: formatTON(data.amount_ton) }));
        } catch (e) {
            notifyError(); sfx.play("loss_thud", { volume: 0.5 });
            toast.error(e?.response?.data?.detail || "bet failed");
        } finally {
            setPlacing(false);
        }
    };

    const cashout = async () => {
        if (cashingOut || !myBet || myBet.status !== "placed") return;
        setCashingOut(true);
        tapHeavy();
        try {
            const { data } = await http.post("/crash/cashout", { bet_id: myBet.bet_id });
            setMyBet({ ...myBet, cashed_at_x: data.cashed_at_x, payout_ton: data.payout_ton, status: "won" });
            refreshBalance?.();
            notifySuccess(); sfx.play("success_bell", { volume: 0.75 });
            toast.success(t("crash.toast.cashout_ok", {
                x: data.cashed_at_x.toFixed(2), payout: formatTON(data.payout_ton),
            }));
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "cashout failed");
        } finally {
            setCashingOut(false);
        }
    };

    const canBet = phase === "betting" && !(myBet && myBet.round_id === state?.round_id);
    const canCashout = phase === "running" && myBet && myBet.status === "placed";
    const crashedX = state?.crash_multiplier;

    // ── Validation state for inputs (Polish §9) ────────────────────────────
    const betNum = Number(betAmount);
    const autoXNum = autoX === "" ? null : Number(autoX);
    const betError = useMemo(() => {
        if (betAmount === "" || isNaN(betNum)) return "crash.validation.bet_required";
        if (betNum < 0.1)   return "crash.validation.bet_min";
        if (betNum > 200)   return "crash.validation.bet_max";
        if (betNum > (balance ?? 0)) return "crash.validation.bet_insufficient";
        return null;
    }, [betAmount, betNum, balance]);
    const autoXError = useMemo(() => {
        if (autoX === "") return null;
        if (isNaN(autoXNum) || autoXNum < 1.01) return "crash.validation.auto_min";
        return null;
    }, [autoX, autoXNum]);
    const phaseError = phase !== "betting" ? "crash.validation.phase_closed" : null;
    const blockingError = betError || autoXError || phaseError;
    const insufficient = betError === "crash.validation.bet_insufficient";
    const phaseLabel = useMemo(() => {
        if (!state) return t("crash.phase.loading");
        if (phase === "betting") {
            const remaining = Math.max(0, Math.ceil(
                (new Date(state.phase_ends_at).getTime() - Date.now()) / 1000,
            ));
            return t("crash.phase.betting", { sec: remaining });
        }
        if (phase === "running")  return t("crash.phase.running");
        if (phase === "crashed")  return t("crash.phase.crashed", { x: crashedX?.toFixed(2) ?? "—" });
        return "";
    }, [state, phase, crashedX, t]);

    return (
        <main
            data-testid="crash-page"
            // Polish · use --app-vh fallback (publishes from telegram.js) so the
            // page fills the viewport on iOS Telegram WebView. Pre-mount tg.ready()
            // has already populated --app-vh from viewportStableHeight.
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            className="mx-auto px-3 sm:px-6 pt-4 pb-28 lg:pb-6 space-y-4 max-w-[430px] sm:max-w-[640px] lg:max-w-[1100px]"
        >
            {/* Hero banner */}
            <header
                data-testid="crash-hero"
                className="relative overflow-hidden rounded-3xl border border-white/10 -mx-1"
                style={{
                    backgroundImage: "url(/banners/crash.png)",
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
                            <Rocket className="w-3 h-3" /> {t("crash.tag")}
                        </div>
                        <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-white mt-1 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                            {t("crash.title")}
                        </h1>
                        <p className="text-[11px] sm:text-xs text-white/80 mt-1 max-w-[14rem] leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                            {t("crash.subtitle")}
                        </p>
                    </div>
                </div>
            </header>

            {/* Phase chip + provably-fair entry */}
            <div className="flex items-center justify-between gap-2 px-1">
                <div className="text-xs sm:text-sm font-bold text-white/85 tabular-nums" data-testid="crash-phase-label">
                    {phaseLabel}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-white/30 font-bold flex items-center gap-1">
                    <Shield className="w-3 h-3" /> {t("crash.provably_fair")}
                </div>
            </div>

            {/* Main multiplier display */}
            <section
                data-testid="crash-display"
                className="relative overflow-hidden rounded-3xl border border-gold-500/20 bg-[radial-gradient(circle_at_50%_45%,rgba(212,175,55,0.10),transparent_65%)] bg-surface-2 p-6 sm:p-10 min-h-[260px] flex flex-col items-center justify-center"
            >
                <AnimatePresence mode="wait">
                    {phase === "betting" && (
                        <motion.div key="betting"
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                            className="text-center">
                            <div className="text-[11px] uppercase tracking-[0.32em] text-gold-bright font-bold mb-2">
                                {t("crash.label.next_round_in")}
                            </div>
                            <div className="font-display text-6xl sm:text-7xl font-black tabular-nums text-white">
                                {state ? Math.max(0, Math.ceil((new Date(state.phase_ends_at).getTime() - Date.now()) / 1000)) : "—"}s
                            </div>
                            <div className="text-xs text-white/55 mt-3">
                                {t("crash.label.place_your_bet")}
                            </div>
                        </motion.div>
                    )}
                    {phase === "running" && (
                        <motion.div key="running"
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="text-center">
                            {/* Phase 11.2.1 hot-fix — the big multiplier is mutated
                                DIRECTLY in the DOM via multiplierDomRef so React
                                doesn't re-render at 60 Hz. tier→colour switch
                                happens via data-attribute + Tailwind data-[]
                                selectors (no JSX re-render on tier change). */}
                            <div
                                ref={multiplierDomRef}
                                data-testid="crash-multiplier-value"
                                data-tier="low"
                                className="font-display text-6xl sm:text-8xl font-black tabular-nums
                                           text-rose-400
                                           data-[tier=mid]:text-amber-300
                                           data-[tier=hi]:text-emerald-300
                                           data-[tier=epic]:text-yellow-300"
                                style={{ transform: "translateZ(0)", willChange: "transform, color", contain: "layout paint" }}
                            >
                                1.00×
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.32em] text-white/55 font-bold mt-3">
                                <Rocket className="inline w-3.5 h-3.5 mr-1" /> {t("crash.label.flying")}
                            </div>
                        </motion.div>
                    )}
                    {phase === "crashed" && (
                        <motion.div key="crashed"
                            initial={{ scale: 1.15 }}
                            animate={PRM() ? { scale: 1 } : { scale: 1, x: [0, -8, 8, -6, 6, 0] }}
                            exit={{ opacity: 0 }}
                            transition={{ x: { duration: 0.45 } }}
                            className="text-center">
                            <div className="text-[11px] uppercase tracking-[0.32em] text-rose-400 font-bold mb-2 flex items-center justify-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" /> {t("crash.label.crashed_at")}
                            </div>
                            <div className="font-display text-6xl sm:text-8xl font-black tabular-nums text-rose-400 drop-shadow-[0_4px_24px_rgba(244,63,94,0.5)]">
                                {crashedX?.toFixed(2) ?? "—"}×
                            </div>
                            {myBet?.status === "won" && (
                                <div className="text-[11px] text-emerald-300 mt-3 font-bold">
                                    {t("crash.label.you_won", { x: myBet.cashed_at_x.toFixed(2), payout: formatTON(myBet.payout_ton) })}
                                </div>
                            )}
                            {myBet?.status === "lost" && (
                                <div className="text-[11px] text-rose-300 mt-3 font-bold">
                                    {t("crash.label.you_lost", { amount: formatTON(myBet.amount_ton) })}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </section>

            {/* Bet / Cashout panel */}
            <section className="rounded-2xl border border-white/10 bg-cyber-surface/55 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <label className="block text-[10px] uppercase tracking-wider text-white/55 font-bold">
                        {t("crash.bet_amount_ton")}
                        <input
                            data-testid="crash-bet-amount"
                            type="number" inputMode="decimal" min="0.1" max="200" step="0.1"
                            value={betAmount}
                            onChange={(e) => setBetAmount(e.target.value)}
                            disabled={phase !== "betting"}
                            aria-invalid={Boolean(betError)}
                            className={`mt-1 w-full bg-cyber-bg border rounded-lg px-3 py-2 text-base text-white font-bold tabular-nums focus:outline-none disabled:opacity-50 transition ${
                                betError
                                    ? "border-rose-500/60 focus:border-rose-400"
                                    : "border-white/15 focus:border-gold-bright/55"
                            }`}
                        />
                        {betError && (
                            <span data-testid="crash-bet-error" className="block mt-1 text-[10px] text-rose-300 font-bold normal-case">
                                {t(betError)}
                            </span>
                        )}
                    </label>
                    <label className="block text-[10px] uppercase tracking-wider text-white/55 font-bold">
                        {t("crash.auto_cashout_x")}
                        <input
                            data-testid="crash-auto-x"
                            type="number" inputMode="decimal" min="1.01" step="0.01" placeholder={t("crash.auto_cashout_placeholder")}
                            value={autoX}
                            onChange={(e) => setAutoX(e.target.value)}
                            disabled={phase !== "betting"}
                            aria-invalid={Boolean(autoXError)}
                            className={`mt-1 w-full bg-cyber-bg border rounded-lg px-3 py-2 text-base text-white font-bold tabular-nums focus:outline-none disabled:opacity-50 transition ${
                                autoXError
                                    ? "border-rose-500/60 focus:border-rose-400"
                                    : "border-white/15 focus:border-gold-bright/55"
                            }`}
                        />
                        {autoXError && (
                            <span data-testid="crash-auto-error" className="block mt-1 text-[10px] text-rose-300 font-bold normal-case">
                                {t(autoXError)}
                            </span>
                        )}
                    </label>
                </div>
                <div className="flex items-center gap-2 -mt-1">
                    {[0.5, 1, 5, 25].map((v) => (
                        <button
                            key={v}
                            onClick={() => { selectionChanged(); setBetAmount(v); }}
                            data-testid={`crash-quick-${v}`}
                            disabled={phase !== "betting"}
                            className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-md border border-white/15 bg-white/[0.04] text-white/65 hover:text-white hover:border-white/30 disabled:opacity-40"
                        >
                            {v}
                        </button>
                    ))}
                </div>
                {!canCashout ? (
                    insufficient ? (
                        <a
                            href="#deposit"
                            data-testid="crash-deposit-cta"
                            onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("lydo:open-deposit")); }}
                            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-b from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide shadow-[0_8px_24px_-6px_rgba(212,175,55,0.55)]"
                        >
                            {t("crash.deposit_cta")}
                        </a>
                    ) : (
                        <button
                            data-testid="crash-bet-btn"
                            onClick={placeBet}
                            disabled={!canBet || placing || Boolean(blockingError)}
                            title={blockingError ? t(blockingError) : undefined}
                            className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-b from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_-6px_rgba(212,175,55,0.55)]"
                        >
                            <Zap className="w-4 h-4" />
                            {placing
                                ? t("crash.placing")
                                : (myBet && myBet.round_id === state?.round_id
                                    ? t("crash.bet_placed", { amount: formatTON(myBet.amount_ton) })
                                    : t("crash.place_bet"))}
                        </button>
                    )
                ) : (
                    <button
                        data-testid="crash-cashout-btn"
                        onClick={cashout}
                        disabled={cashingOut}
                        className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-black font-display font-bold text-sm rounded-xl py-3 uppercase tracking-wide disabled:opacity-40 shadow-[0_4px_20px_-4px_rgba(16,185,129,0.5)]"
                    >
                        <TrendingUp className="w-4 h-4" />
                        {t("crash.cashout_now", { x: liveX.toFixed(2), payout: formatTON(myBet.amount_ton * liveX) })}
                    </button>
                )}
            </section>

            {/* History strip */}
            <section data-testid="crash-history" className="rounded-2xl border border-white/10 bg-cyber-surface/35 p-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                    <History className="w-3.5 h-3.5 text-white/40" />
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-bold">{t("crash.history_label")}</div>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {history.length === 0 && (
                        <div className="text-[10px] text-white/30 italic px-1 py-1">{t("crash.no_history")}</div>
                    )}
                    {history.map((h, i) => (
                        <span
                            key={h.round_id || i}
                            className={`px-2 py-1 rounded-md text-[10px] font-bold tabular-nums border flex-shrink-0 ${tierBg(h.crash_multiplier)}`}
                        >
                            {h.crash_multiplier?.toFixed(2)}×
                        </span>
                    ))}
                </div>
            </section>

            {/* Live bets feed */}
            <section data-testid="crash-bets-feed" className="rounded-2xl border border-white/10 bg-cyber-surface/35 p-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                    <Users className="w-3.5 h-3.5 text-white/40" />
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-bold">
                        {t("crash.bets_label", { n: bets.length })}
                    </div>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {bets.length === 0 && (
                        <div className="text-[10px] text-white/30 italic px-1 py-1">{t("crash.no_bets")}</div>
                    )}
                    {bets.map((b) => (
                        <div
                            key={b.bet_id}
                            className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/10"
                        >
                            {b.photo_url ? (
                                <img src={b.photo_url} alt="" className="w-5 h-5 rounded-full" />
                            ) : (
                                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-gold-300 to-gold-600" />
                            )}
                            <span className="flex-1 truncate text-white/75">{b.username || "anon"}</span>
                            <span className="font-bold tabular-nums text-white/85">{formatTON(b.amount_ton)} TON</span>
                            {b.status === "won" ? (
                                <span className="text-[10px] font-bold tabular-nums text-emerald-300">
                                    ×{b.cashed_at_x?.toFixed(2)} → +{formatTON(b.payout_ton)}
                                </span>
                            ) : (b.auto_cashout_x ? (
                                <span className="text-[10px] font-bold tabular-nums text-gold-bright">
                                    auto {b.auto_cashout_x.toFixed(2)}×
                                </span>
                            ) : null)}
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
};

export default CrashPage;
