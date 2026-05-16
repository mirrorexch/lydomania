/**
 * Phase 4b — Daily Free Case tile (home + cases list).
 *
 * Shows availability + countdown + spin button. Reuses CaseOpenAnimation +
 * WinModal on the cases list page (we just navigate to /cases/free_case once
 * opened — same UX as paid cases).
 */
import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Gift, Sparkles, Timer, Lock, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { freeCaseCooldown } from "@/lib/api";

function fmtCountdown(seconds) {
    if (seconds <= 0) return "0:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const DailyFreeCaseTile = () => {
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [err, setErr] = useState(null);

    const load = useCallback(async () => {
        setErr(null);
        try {
            const r = await freeCaseCooldown();
            setStatus(r);
            setRemaining(Math.max(0, Number(r.seconds_remaining || 0)));
        } catch (e) {
            // 404 means free case isn't configured — silently hide tile
            if (e?.response?.status === 404) { setStatus({ hidden: true }); return; }
            setErr(e?.response?.data?.detail || e?.message);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (remaining <= 0) return;
        const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
        return () => clearInterval(t);
    }, [remaining]);

    if (!status || status.hidden) return null;

    const tokens = Number(status.free_spin_tokens || 0);
    const isAvailable = remaining <= 0 || tokens > 0;
    const usingToken = remaining > 0 && tokens > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            data-testid="daily-free-case-tile"
            className="relative rounded-xl border border-emerald-500/35 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-3.5 overflow-hidden mb-3"
        >
            <div className="absolute -top-6 -right-6 w-32 h-32 bg-emerald-400/15 blur-3xl rounded-full pointer-events-none" />
            <div className="relative flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/35 flex items-center justify-center shrink-0">
                    <Gift className="w-7 h-7 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <h3 className="text-[13px] font-black uppercase tracking-wider text-emerald-100">Daily Free Spin</h3>
                        <Sparkles className="w-3 h-3 text-emerald-300/70" />
                    </div>
                    <div className="text-[10.5px] text-emerald-200/70 leading-snug">
                        {isAvailable
                            ? (usingToken ? `Use a free-spin token (${tokens} left) — bypass cooldown` : "Free reward available — spin once every 24h")
                            : `Next spin in ${fmtCountdown(remaining)}`}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => isAvailable && navigate("/cases/free_case")}
                    disabled={!isAvailable}
                    data-testid="daily-free-case-spin-btn"
                    className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-lg transition shrink-0
                        ${isAvailable
                            ? "bg-emerald-400 text-cyber-bg shadow-[0_0_18px_rgba(16,185,129,0.45)] hover:shadow-[0_0_22px_rgba(16,185,129,0.65)] active:scale-95"
                            : "bg-white/5 text-white/35 border border-white/10 cursor-not-allowed"}`}
                >
                    {isAvailable
                        ? <><Sparkles className="w-3.5 h-3.5" /> Spin</>
                        : <><Timer className="w-3.5 h-3.5" /> Locked</>
                    }
                </button>
            </div>
            {err && <div className="mt-2 text-[10px] text-red-300">{err}</div>}
        </motion.div>
    );
};

export default DailyFreeCaseTile;
