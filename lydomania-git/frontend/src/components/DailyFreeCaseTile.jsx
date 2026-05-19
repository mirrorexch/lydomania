/**
 * Phase 4b — Daily Free Case tile (home + cases list).
 */
import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Gift, Sparkles, Timer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { freeCaseCooldown } from "@/lib/api";
import { sfx } from "@/lib/sound";

function fmtCountdown(seconds) {
    if (seconds <= 0) return "0:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const DailyFreeCaseTile = () => {
    const { t } = useTranslation();
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
            if (e?.response?.status === 404) { setStatus({ hidden: true }); return; }
            setErr(e?.response?.data?.detail || e?.message);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (remaining <= 0) return;
        const tt = setInterval(() => setRemaining((r) => {
            const next = Math.max(0, r - 1);
            if (next === 0 && r > 0) {
                // Cooldown just elapsed — ping the user (subtle, respects mute).
                sfx.play("free_case_ready", { volume: 0.55 });
            }
            return next;
        }), 1000);
        return () => clearInterval(tt);
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
                        <h3 className="text-[13px] font-black uppercase tracking-wider text-emerald-100">
                            {t("free_case.title")}
                        </h3>
                        <Sparkles className="w-3 h-3 text-emerald-300/70" />
                    </div>
                    <div className="text-[10.5px] text-emerald-200/70 leading-snug">
                        {isAvailable
                            ? (usingToken
                                ? t("free_case.use_token", { tokens })
                                : t("free_case.available"))
                            : t("free_case.next_in", { time: fmtCountdown(remaining) })}
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
                        ? <><Sparkles className="w-3.5 h-3.5" /> {t("free_case.spin")}</>
                        : <><Timer className="w-3.5 h-3.5" /> {t("free_case.locked")}</>
                    }
                </button>
            </div>
            {err && <div className="mt-2 text-[10px] text-red-300">{err}</div>}
        </motion.div>
    );
};

export default DailyFreeCaseTile;
