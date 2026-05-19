/**
 * Phase 8 — Achievements page. Grid of badges, locked/unlocked/claimed states.
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
    Award, Lock, Check, Loader2, Sparkles, Package, Disc3, Rocket, CircleDot,
    Bomb, Package as Package2, Swords, TrendingUp, Zap, Coins, Crown, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";

const ICONS = {
    sparkles: Sparkles, package: Package, disc: Disc3, rocket: Rocket,
    "circle-dot": CircleDot, bomb: Bomb, "package-2": Package2, "disc-3": Disc3,
    swords: Swords, "trending-up": TrendingUp, zap: Zap, coins: Coins,
    crown: Crown, "shield-check": ShieldCheck,
};


export default function AchievementsPage({ user, refreshBalance }) {
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState(null);

    const fetchAll = useCallback(async () => {
        try {
            const { data } = await http.get("/achievements/me");
            setRows(data.rows || []);
        } catch (_) { toast.error("Couldn't load achievements."); }
    }, []);
    useEffect(() => { if (user) fetchAll(); }, [user, fetchAll]);

    const claim = useCallback(async (aid) => {
        setBusy(aid); tapMedium();
        try {
            await http.post("/achievements/claim", { achievement_id: aid });
            sfx.play("success_bell", { volume: 0.45 });
            sfx.play("confetti_burst", { volume: 0.4 });
            tapHeavy(); notifySuccess();
            toast.success("Achievement reward claimed.");
            refreshBalance?.();
            await fetchAll();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Claim failed");
        } finally { setBusy(null); }
    }, [refreshBalance, fetchAll]);

    if (!user) return <main className="p-6 text-center text-white/60" data-testid="achievements-page">Sign in to view achievements.</main>;

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-3xl mx-auto w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="achievements-page"
        >
            <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="relative rounded-2xl border border-gold-500/30 overflow-hidden p-4"
                style={{ minHeight: 120, background: "linear-gradient(120deg, rgba(15,12,5,0.95), rgba(15,12,5,0.55) 60%, transparent), radial-gradient(circle at 90% 50%, rgba(255,215,0,0.22), transparent 60%), #0b0905" }}
                data-testid="achievements-hero"
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <Award className="w-4 h-4 text-gold-bright" />
                    <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-gold-bright/90">Badges</span>
                </div>
                <h1 className="text-2xl font-bold text-white">Achievements</h1>
                <p className="text-sm text-white/70 mt-1">Unlock badges for milestones. Claim rewards once unlocked.</p>
            </motion.div>

            <section
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                data-testid="achievements-grid"
            >
                {!rows && [0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-32 rounded-xl bg-zinc-900/60 animate-pulse" />
                ))}
                {rows?.map((a) => {
                    const Icon = ICONS[a.icon] || Award;
                    const pct = Math.round((a.progress / Math.max(1, a.target)) * 100);
                    return (
                        <motion.div
                            key={a.achievement_id}
                            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                            className={`relative rounded-xl border p-3 ${
                                a.unlocked ? "bg-gold-500/10 border-gold-500/40 shadow-[0_0_18px_-6px_rgba(212,175,55,0.45)]" : "bg-zinc-900/60 border-white/10"
                            }`}
                            data-testid={`achievement-card-${a.achievement_id}`}
                        >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                                a.unlocked ? "bg-gold-bright/20 text-gold-bright" : "bg-white/5 text-white/30"
                            }`}>
                                {a.unlocked ? <Icon className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                            </div>
                            <h3 className="text-xs font-bold text-white leading-tight mb-0.5">{a.name}</h3>
                            <p className="text-[10px] text-white/55 leading-snug line-clamp-2">{a.description}</p>
                            {a.target > 1 && !a.unlocked && (
                                <div className="mt-1.5">
                                    <div className="h-1 rounded-full bg-black/40 overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-gold-400 via-gold-bright to-gold-500 rounded-full shadow-[0_0_8px_-1px_rgba(255,215,0,0.55)]" style={{ width: `${pct}%` }} />
                                    </div>
                                    <div className="text-[9px] font-mono text-white/40 mt-0.5">{a.progress}/{a.target}</div>
                                </div>
                            )}
                            <div className="mt-2 text-[10px] font-mono text-gold-bright/85">
                                {a.reward?.type === "ton" && `+${formatTON(a.reward.amount_ton)} TON`}
                                {a.reward?.type === "xp" && `+${a.reward.amount} XP`}
                                {a.reward?.type === "free_spin" && `×${a.reward.count} free spin`}
                            </div>
                            {a.unlocked && !a.claimed && (
                                <button
                                    type="button" onClick={() => claim(a.achievement_id)} disabled={busy === a.achievement_id}
                                    className="mt-2 w-full py-1 rounded-md bg-gradient-to-b from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1 shadow-[0_4px_12px_-3px_rgba(212,175,55,0.55)]"
                                    data-testid={`achievement-${a.achievement_id}-claim-btn`}
                                >
                                    {busy === a.achievement_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Award className="w-3 h-3" />}
                                    Claim
                                </button>
                            )}
                            {a.claimed && (
                                <div className="mt-2 w-full py-1 rounded-md bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center gap-1" data-testid={`achievement-${a.achievement_id}-claimed`}>
                                    <Check className="w-3 h-3" /> Claimed
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </section>
        </main>
    );
}
