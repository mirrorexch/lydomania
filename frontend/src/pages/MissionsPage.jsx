/**
 * Phase 8 — Daily Missions page.
 * 3 daily missions per user, progress + claim button per mission.
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Check, Loader2, Coins, Sparkles, Award } from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";

const PRM = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


function RewardChip({ reward }) {
    if (!reward) return null;
    if (reward.type === "ton")
        return <span className="text-gold-bright font-luxe font-bold text-xs"><Coins className="inline w-3 h-3 mr-0.5"/>{formatTON(reward.amount_ton)} TON</span>;
    if (reward.type === "free_spin")
        return <span className="text-gold-300 font-mono text-xs"><Sparkles className="inline w-3 h-3 mr-0.5"/>×{reward.count} spin</span>;
    if (reward.type === "xp")
        return <span className="text-gold-200 font-mono text-xs">+{reward.amount} XP</span>;
    return null;
}


export default function MissionsPage({ user, refreshBalance }) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(null);   // mission_id being claimed

    const fetchDaily = useCallback(async () => {
        try {
            const { data } = await http.get("/missions/daily");
            setData(data);
        } catch (_) { toast.error("Couldn't load daily missions."); }
    }, []);
    useEffect(() => { if (user) fetchDaily(); }, [user, fetchDaily]);

    const claim = useCallback(async (missionId) => {
        setBusy(missionId); tapMedium();
        try {
            await http.post("/missions/claim", { mission_id: missionId });
            sfx.play("success_bell", { volume: 0.45 });
            sfx.play("confetti_burst", { volume: 0.4 });
            tapHeavy(); notifySuccess();
            toast.success("Reward claimed.");
            refreshBalance?.();
            await fetchDaily();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Claim failed");
        } finally { setBusy(null); }
    }, [refreshBalance, fetchDaily]);

    if (!user) return <main className="p-6 text-center text-white/60" data-testid="missions-page">Sign in to view missions.</main>;

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-2xl mx-auto w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="missions-page"
        >
            <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: PRM() ? 0 : 0.3 }}
                className="relative rounded-2xl border border-gold-500/25 overflow-hidden p-4 bg-gradient-to-br from-gold-700/25 via-surface-2 to-surface-1 shadow-gold-glow"
                style={{ minHeight: 120 }}
                data-testid="missions-hero"
            >
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_50%,rgba(255,215,0,0.18),transparent_60%)]" />
                <div className="relative flex items-center gap-2 mb-1.5">
                    <Target className="w-4 h-4 text-gold-bright" />
                    <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-gold-bright/90">
                        {data?.date_utc || "Daily missions"}
                    </span>
                </div>
                <h1 className="relative text-2xl font-bold text-white">Daily Missions</h1>
                <p className="relative text-sm text-white/70 mt-1">3 new objectives every day. Reset at UTC midnight.</p>
            </motion.div>

            <section className="space-y-2" data-testid="missions-list">
                {!data && (
                    <div className="space-y-2">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-20 rounded-xl bg-zinc-900/60 animate-pulse" />
                        ))}
                    </div>
                )}
                {data?.missions?.map((m) => {
                    const pct = Math.round((m.progress / Math.max(1, m.target)) * 100);
                    return (
                        <motion.div
                            key={m.id}
                            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl bg-surface-1 border border-gold-500/10 hover:border-gold-500/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-gold-glow p-3"
                            data-testid={`mission-card-${m.id}`}
                        >
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-semibold text-white truncate">{m.title}</h3>
                                    <RewardChip reward={m.reward} />
                                </div>
                                <span className="text-[10px] font-luxe text-gold-300/75 tabular-nums shrink-0 font-bold">
                                    {m.progress}/{m.target}
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2">
                                <motion.div
                                    initial={false}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.6 }}
                                    style={{ width: `${pct}%` }}
                                    className="h-full rounded-full bg-gradient-to-r from-gold-400 via-gold-bright to-gold-500"
                                />
                            </div>
                            {m.claimed ? (
                                <div className="flex items-center justify-center py-1.5 rounded-md bg-gold-500/15 border border-gold-500/40 text-gold-200 text-[11px] font-bold uppercase tracking-wider" data-testid={`mission-${m.id}-claimed`}>
                                    <Check className="w-3.5 h-3.5 mr-1" /> Claimed
                                </div>
                            ) : m.complete ? (
                                <button
                                    type="button" onClick={() => claim(m.id)} disabled={busy === m.id}
                                    className="w-full py-1.5 rounded-md bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 text-[11px] font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5"
                                    data-testid={`mission-${m.id}-claim-btn`}
                                >
                                    {busy === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Award className="w-3.5 h-3.5" />}
                                    Claim reward
                                </button>
                            ) : (
                                <div className="text-center py-1.5 text-[11px] uppercase tracking-wider text-white/40 font-bold" data-testid={`mission-${m.id}-locked`}>
                                    In progress
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </section>
        </main>
    );
}
