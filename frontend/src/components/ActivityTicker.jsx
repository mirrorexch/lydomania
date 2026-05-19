/**
 * Phase 11 — Live Wins horizontal marquee ticker.
 *
 * Stake/Rollbit-style: sticky 64px bar that slides chips right-to-left,
 * pause-on-hover, glassy black bg + gold border-bottom + low-opacity
 * marquee_backdrop texture. WS-driven with REST polling fallback (same
 * interface as the prior vertical version).
 *
 * Drop on Home (top, above hero).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Zap } from "lucide-react";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { GameIcon } from "@/components/common/GameIcon";

const MAX_VISIBLE = 18;

function wsUrl() {
    const base = process.env.REACT_APP_BACKEND_URL || "";
    if (!base) return "";
    return base.replace(/^http/, "ws") + "/api/ws/activity";
}

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


export default function ActivityTicker() {
    const [rows, setRows] = useState([]);
    const [paused, setPaused] = useState(false);
    const wsRef = useRef(null);
    const pollRef = useRef(null);

    const pushRow = useCallback((row) => {
        setRows((prev) => [row, ...prev].slice(0, MAX_VISIBLE));
    }, []);

    const startPolling = useCallback(() => {
        if (pollRef.current) return;
        pollRef.current = setInterval(async () => {
            try {
                const { data } = await http.get("/activity/recent", { params: { limit: MAX_VISIBLE } });
                setRows((data?.rows || []).slice(0, MAX_VISIBLE));
            } catch (_) {}
        }, 10_000);
    }, []);

    useEffect(() => {
        const url = wsUrl();
        if (!url || typeof WebSocket === "undefined") { startPolling(); return; }
        let connected = false;
        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;
            ws.onopen = () => { connected = true; };
            ws.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === "hello" && Array.isArray(data.rows)) {
                        setRows(data.rows.slice(0, MAX_VISIBLE));
                    } else if (data.type === "activity") {
                        pushRow(data);
                    }
                } catch (_) {}
            };
            ws.onerror = () => { if (!connected) startPolling(); };
            ws.onclose = () => { startPolling(); };
        } catch (_) { startPolling(); }
        return () => {
            try { wsRef.current?.close(); } catch (_) {}
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [pushRow, startPolling]);

    // REST hydrate
    useEffect(() => {
        (async () => {
            try {
                const { data } = await http.get("/activity/recent", { params: { limit: MAX_VISIBLE } });
                if ((data?.rows || []).length > 0) setRows(data.rows.slice(0, MAX_VISIBLE));
            } catch (_) {}
        })();
    }, []);

    // Phase 11 — double up the rows so the CSS marquee can loop seamlessly
    // (translateX(0) → translateX(-50%) lands on the start of the second copy).
    const looped = useMemo(() => [...rows, ...rows], [rows]);

    if (rows.length === 0) return null;
    const reduce = PRM();

    return (
        <section
            data-testid="activity-ticker"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            className="relative h-[64px] overflow-hidden rounded-xl border border-gold-500/15
                       bg-black/55 backdrop-blur-md
                       shadow-[0_2px_24px_-6px_rgba(212,175,55,0.18)]"
            style={{
                backgroundImage: "url(/banners/live_wins_marquee_backdrop.webp)",
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundBlendMode: "overlay",
            }}
            aria-label="Live wins ticker"
        >
            {/* Left fade-out edge for cleaner ticker feel */}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-20 z-10 bg-gradient-to-r from-black/85 to-transparent" />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-20 z-10 bg-gradient-to-l from-black/85 to-transparent" />

            {/* LIVE chip + pulse dot */}
            <div className="absolute left-3 inset-y-0 z-20 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-gold-bright/15 border border-gold-bright/40 text-gold-bright px-1.5 py-0.5">
                    <Zap className="w-3 h-3" strokeWidth={2.5} />
                    <span className="text-[9px] font-black uppercase tracking-[0.18em]">Live</span>
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            </div>

            {/* Marquee strip */}
            <div
                className="h-full flex items-center gap-2 pl-24 pr-6 whitespace-nowrap will-change-transform"
                style={{
                    animation: reduce ? "none" : "marquee-scroll 50s linear infinite",
                    animationPlayState: paused ? "paused" : "running",
                }}
            >
                {looped.map((r, i) => (
                    <Chip key={`${r.id}-${i}`} row={r} />
                ))}
            </div>
        </section>
    );
}


const Chip = ({ row: r }) => {
    const m = Number(r.multiplier) || 0;
    const big = m >= 5;
    return (
        <div
            data-testid={`activity-row-${r.id}`}
            className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1
                       bg-black/55 border border-gold-500/15 backdrop-blur-sm
                       hover:border-gold-bright/45 transition-colors"
        >
            {r.photo_url ? (
                <img
                    src={r.photo_url} alt=""
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
            ) : (
                <div className="w-6 h-6 rounded-full bg-zinc-700 grid place-items-center text-[10px] text-zinc-200">
                    {(r.user_handle || "?").charAt(0).toUpperCase()}
                </div>
            )}
            <span className="text-white/85 text-xs font-semibold truncate max-w-[80px]">{r.user_handle}</span>
            <GameIcon game={r.game} size="sm" className="!w-6 !h-6" />
            <span className="text-[10px] uppercase tracking-wider text-white/45 font-bold">{r.game}</span>
            {m > 0 && (
                <span
                    className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md ${
                        big
                            ? "bg-gold-bright text-zinc-950 shadow-[0_0_12px_rgba(255,215,0,0.5)]"
                            : "bg-gold-500/15 text-gold-300 border border-gold-500/30"
                    }`}
                >
                    {m}×
                </span>
            )}
            <span className="text-gold-bright text-sm font-luxe font-bold tabular-nums">
                +{formatTON(r.payout_ton)}
            </span>
            <span className="text-[9px] uppercase text-gold-400/70 font-bold">TON</span>
        </div>
    );
};
