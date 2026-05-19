/**
 * Phase 11.1 — Live "Today's Jackpot" counter for the Home hero.
 *
 * Fetches /api/activity/jackpot-24h on mount. Subscribes to /api/ws/activity
 * — when a new activity event ticks the WS, re-fetch (5s server cache
 * absorbs the load). Animates the value upward over ~600ms with
 * requestAnimationFrame easing. Pulses gold-glow on each increment.
 * PRM-aware: instant set, no animation.
 */
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { http } from "@/lib/api";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function wsUrl() {
    const base = process.env.REACT_APP_BACKEND_URL || "";
    if (!base) return "";
    return base.replace(/^http/, "ws") + "/api/ws/activity";
}


export const JackpotCounter = ({ className = "" }) => {
    const { t } = useTranslation();
    const [target, setTarget] = useState(0);
    const [display, setDisplay] = useState(0);
    const [pulsing, setPulsing] = useState(false);
    const wsRef = useRef(null);
    const rafRef = useRef(null);

    const fetchOnce = async () => {
        try {
            const { data } = await http.get("/activity/jackpot-24h");
            const v = Number(data?.jackpot_ton || 0);
            setTarget(v);
        } catch { /* */ }
    };

    useEffect(() => { fetchOnce(); }, []);

    // Animate `display` → `target` over ~700ms
    useEffect(() => {
        const startVal = display;
        const endVal = target;
        if (endVal === startVal) return;
        if (PRM()) {
            setDisplay(endVal);
            return;
        }
        const startTs = performance.now();
        const DURATION = 700;
        const tick = (ts) => {
            const t = Math.min(1, (ts - startTs) / DURATION);
            const v = startVal + (endVal - startVal) * easeOutCubic(t);
            setDisplay(v);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        if (endVal > startVal) {
            setPulsing(true);
            setTimeout(() => setPulsing(false), 800);
        }
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [target]);  // eslint-disable-line react-hooks/exhaustive-deps

    // WS subscription
    useEffect(() => {
        const url = wsUrl();
        if (!url || typeof WebSocket === "undefined") return;
        let pending = null;
        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;
            ws.onmessage = (e) => {
                try {
                    const d = JSON.parse(e.data);
                    if (d.type === "activity") {
                        if (pending) clearTimeout(pending);
                        pending = setTimeout(fetchOnce, 1200);
                    }
                } catch { /* */ }
            };
        } catch { /* */ }
        return () => {
            if (pending) clearTimeout(pending);
            try { wsRef.current?.close(); } catch { /* */ }
        };
    }, []);

    return (
        <div
            data-testid="hero-jackpot-counter"
            className={
                `relative bg-black/40 backdrop-blur-sm border rounded-xl px-3 py-2.5 transition-all duration-300 ` +
                (pulsing
                    ? "border-gold-bright/60 shadow-[0_0_28px_rgba(255,215,0,0.45)]"
                    : "border-gold-500/20"
                ) + " " + className
            }
        >
            <div className="text-[9px] uppercase tracking-[0.18em] text-gold-300/75 font-bold mb-0.5 flex items-center gap-1">
                <span>{t("home.stats.jackpot_today", { defaultValue: "Today's jackpot" })}</span>
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-1">
                <span
                    data-testid="hero-jackpot-value"
                    className="font-luxe text-2xl sm:text-3xl font-bold text-gold-bright tabular-nums leading-none drop-shadow-[0_0_12px_rgba(255,215,0,0.45)]"
                >
                    {display < 1000
                        ? display.toFixed(2)
                        : display < 10000
                            ? display.toFixed(1)
                            : Math.floor(display).toLocaleString()}
                </span>
                <span className="text-[10px] text-gold-300 font-bold uppercase">TON</span>
            </div>
        </div>
    );
};

export default JackpotCounter;
