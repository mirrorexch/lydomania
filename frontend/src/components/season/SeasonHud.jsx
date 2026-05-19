/**
 * Phase 7c — Global XP HUD shown under the Header balance pill.
 *
 * Fetches /api/season/current periodically (also when balance changes),
 * displays:
 *   • thin gradient progress bar (XP into current tier)
 *   • tier number to the right
 *   • "+N XP" sonner toasts when XP increases between polls (with source guess)
 *
 * Skipped entirely when user is unauthenticated.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { RollingNumber } from "@/components/RollingNumber";
import { sfx } from "@/lib/sound";
import { tapMedium } from "@/lib/haptics";


const POLL_INTERVAL_MS = 15_000;

export default function SeasonHud({ user, onSeasonChange }) {
    const { t } = useTranslation();
    const [data, setData] = useState(null);          // { progress, season }
    const [busy, setBusy] = useState(false);
    const lastXpRef = useRef(null);

    const fetchOnce = useCallback(async () => {
        if (!user) return;
        try {
            const { data } = await http.get("/season/current");
            setData(data);
            onSeasonChange?.(data);
            const prev = lastXpRef.current;
            const next = data?.progress?.xp ?? 0;
            if (prev != null && next > prev) {
                const delta = next - prev;
                sfx.play("scroll_tick", { volume: 0.25 });
                toast.success(t("season.toast.xp_gained", { n: delta }), {
                    duration: 2200,
                });
                tapMedium();
            }
            lastXpRef.current = next;
        } catch (_e) {
            // silent — HUD is non-critical
        }
    }, [user, onSeasonChange, t]);

    useEffect(() => {
        if (!user) { setData(null); return; }
        fetchOnce();
        const id = setInterval(fetchOnce, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [user, fetchOnce]);

    if (!user || !data?.progress) return null;
    const p = data.progress;
    const into = Math.max(0, Math.min(p.xp_into_current_tier ?? 0, p.xp_for_next_tier ?? 1));
    const needed = Math.max(1, p.xp_for_next_tier ?? 1);
    const pct = Math.min(100, Math.round((into / needed) * 100));
    const isMaxed = (p.next_tier ?? 0) >= (p.total_tiers ?? 30) && (p.xp_for_next_tier ?? 0) === 0;

    return (
        <a
            href="/battlepass"
            className="group block px-3 py-2 mt-1.5 rounded-lg bg-zinc-900/60 border border-white/5 hover:border-amber-300/30 transition-colors"
            data-testid="season-hud"
            aria-label={t("season.hud.aria_label")}
        >
            <div className="flex items-center gap-2 mb-1">
                <Flame className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-400">
                    {t("season.hud.tag")}
                </span>
                <span className="ml-auto text-[11px] font-semibold text-zinc-200" data-testid="season-hud-tier">
                    {t("season.hud.tier_value", { n: p.current_tier ?? 0 })}
                </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-black/40 overflow-hidden">
                <motion.div
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-400 via-gold-bright to-gold-500"
                    style={{ width: `${pct}%` }}
                    data-testid="season-hud-progress-fill"
                />
            </div>
            <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] font-mono text-zinc-500" data-testid="season-hud-xp">
                    {isMaxed
                        ? t("season.hud.maxed")
                        : <RollingNumber value={into} format={(n) => n.toLocaleString()} />}
                    {!isMaxed && (
                        <>
                            <span aria-hidden="true"> / </span>
                            <span>{needed.toLocaleString()}</span>
                            <span aria-hidden="true"> {t("season.xp_short")}</span>
                        </>
                    )}
                </span>
                {!isMaxed && (
                    <span className="text-[10px] font-mono text-amber-300/80 flex items-center gap-1">
                        <Trophy className="w-3 h-3" aria-hidden="true" />
                        {t("season.hud.next_tier", { n: p.next_tier })}
                    </span>
                )}
            </div>
        </a>
    );
}
