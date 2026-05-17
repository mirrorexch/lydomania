/**
 * Phase 6a — Right activity rail (visible at xl+ / ≥1280px).
 *
 * Polls /api/leaderboard?view=won_single&period=week every 12s and shows
 * the 10 most recent big wins, anonymised as @{first}***. Pure presentation —
 * if the API fails, the rail just collapses silently.
 */
import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Diamond, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminLeaderboard, resolveImage } from "@/lib/api";
import { RARITY_HEX, formatTON } from "@/lib/rarity";

const POLL_MS = 12000;

function mask(name) {
    if (!name) return "anon";
    if (name.length <= 3) return `${name}***`;
    return `${name.slice(0, 3)}***`;
}

export const LiveActivityRail = () => {
    const { t } = useTranslation();
    const [rows, setRows] = useState([]);
    const [err, setErr] = useState(null);

    const load = useCallback(async () => {
        try {
            const r = await adminLeaderboard("won_single", "week", 10);
            setRows(Array.isArray(r?.rows) ? r.rows.slice(0, 10) : []);
            setErr(null);
        } catch (e) {
            setErr(e?.response?.data?.detail || e?.message);
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    return (
        <aside
            data-testid="live-activity-rail"
            className="hidden xl:flex flex-col fixed right-0 top-0 bottom-0 w-[300px] z-20
                       bg-cyber-bg/85 backdrop-blur-xl border-l border-white/8 px-4 py-5"
        >
            <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-emerald-300" />
                <h3 className="font-display text-sm font-black uppercase tracking-[0.18em] text-emerald-200">
                    {t("leaderboard.view_top_win")} · {t("leaderboard.this_week_short")}
                </h3>
            </div>

            <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                    {rows.length === 0 && !err && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }}
                            className="text-[11px] text-white/35 italic py-3 text-center"
                        >
                            {t("leaderboard.no_activity_week")}
                        </motion.div>
                    )}
                    {rows.map((row, idx) => {
                        const color = RARITY_HEX[row.extra?.rarity] || RARITY_HEX.epic;
                        const display = row.username || row.first_name || "anon";
                        const img = row.extra?.image_url;
                        return (
                            <motion.div
                                key={`${row.rank}-${row.user_id}-${row.value}`}
                                initial={{ opacity: 0, x: 8 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 12 }}
                                transition={{ delay: idx * 0.02 }}
                                className="rounded-lg border bg-cyber-surface/60 px-2.5 py-2 flex items-center gap-2"
                                style={{ borderColor: `${color}33` }}
                            >
                                <div
                                    className="w-9 h-9 rounded-md bg-cyber-bg flex items-center justify-center flex-shrink-0"
                                    style={{ boxShadow: `inset 0 0 10px ${color}33`, border: `1px solid ${color}44` }}
                                >
                                    {img ? (
                                        <img
                                            src={resolveImage(img)}
                                            alt=""
                                            className="w-7 h-7 object-contain"
                                            style={{ filter: `drop-shadow(0 0 6px ${color}aa)` }}
                                        />
                                    ) : (
                                        <Sparkles className="w-4 h-4" style={{ color }} />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-bold text-white/85 truncate">
                                        @{mask(display)}
                                    </div>
                                    <div className="text-[10px] text-white/45 truncate">
                                        {row.extra?.item_slug || "—"}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[12px] font-black tabular-nums" style={{ color }}>
                                        +{formatTON(row.value, 1)}
                                    </div>
                                    <div className="inline-flex items-center gap-0.5 text-[8.5px] text-white/35 font-bold uppercase tracking-wider">
                                        <Diamond className="w-2 h-2" /> TON
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </aside>
    );
};

export default LiveActivityRail;
