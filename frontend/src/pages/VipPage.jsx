/**
 * Phase 9 — VIP / Loyalty page.
 * Phase 11.1 — Cinematic tier cards w/ 3D medallions (PNG transparent assets).
 *              Promotion celebration via fireLegendaryBurst.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Gem, ShieldCheck, ShieldHalf, Shield, Loader2, Coins, Sparkles, X, TrendingUp, Percent, Zap } from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";
import { ImageWithFallback } from "@/components/common/ImageWithFallback";
import { fireLegendaryBurst } from "@/lib/celebrations";

const PRM = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const TIER_VISUAL = {
    0: { slug: "bronze",   name: "Bronze",   medal: "/vip/vip_tier_bronze.png",   accentBorder: "border-amber-700/45",    accentBg: "from-amber-900/30 to-amber-800/10",  accentText: "text-amber-300",   Icon: Shield      },
    1: { slug: "silver",   name: "Silver",   medal: "/vip/vip_tier_silver.png",   accentBorder: "border-slate-400/45",    accentBg: "from-slate-700/30 to-slate-800/10",  accentText: "text-slate-200",   Icon: ShieldHalf  },
    2: { slug: "gold",     name: "Gold",     medal: "/vip/vip_tier_gold.png",     accentBorder: "border-gold-bright/55",  accentBg: "from-gold-500/25 to-gold-900/15",    accentText: "text-gold-bright", Icon: ShieldCheck },
    3: { slug: "platinum", name: "Platinum", medal: "/vip/vip_tier_platinum.png", accentBorder: "border-zinc-300/55",     accentBg: "from-zinc-200/15 to-zinc-700/15",    accentText: "text-zinc-100",    Icon: Gem         },
    4: { slug: "diamond",  name: "Diamond",  medal: "/vip/vip_tier_diamond.png",  accentBorder: "border-cyan-300/55",     accentBg: "from-cyan-200/15 to-violet-700/20",  accentText: "text-cyan-200",    Icon: Crown       },
};


export default function VipPage({ user, refreshBalance }) {
    const [tiers, setTiers] = useState([]);
    const [me, setMe] = useState(null);
    const [busy, setBusy] = useState(false);
    const [promotionFrom, setPromotionFrom] = useState(null);  // {prev_tier_id, new_tier}
    const prevTierIdRef = useRef(null);

    const fetchAll = useCallback(async () => {
        try {
            const [tiersRes, meRes] = await Promise.all([
                http.get("/vip/tiers"), http.get("/vip/me"),
            ]);
            setTiers(tiersRes.data.tiers || []);
            setMe(meRes.data);
        } catch (_) { toast.error("Couldn't load VIP state."); }
    }, []);
    useEffect(() => { if (user) fetchAll(); }, [user, fetchAll]);

    // Phase 11.1 — Detect mid-session tier promotion. On the very first /vip/me,
    // seed the baseline silently; on every subsequent response, compare tier_id
    // and fire the celebration if it moved up.
    useEffect(() => {
        if (!me?.tier) return;
        const curId = me.tier.tier_id;
        if (prevTierIdRef.current === null) {
            prevTierIdRef.current = curId;
            return;
        }
        if (curId > prevTierIdRef.current) {
            setPromotionFrom({ prev_tier_id: prevTierIdRef.current, new_tier: me.tier });
            fireLegendaryBurst({ intensity: "epic" });
        }
        prevTierIdRef.current = curId;
    }, [me]);

    const claim = useCallback(async () => {
        setBusy(true); tapHeavy();
        try {
            const { data } = await http.post("/vip/claim-rakeback");
            sfx.play("success_bell", { volume: 0.45 });
            notifySuccess();
            toast.success(`Claimed ${formatTON(data.claimed_ton)} TON rakeback.`);
            refreshBalance?.();
            await fetchAll();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Couldn't claim rakeback");
        } finally { setBusy(false); }
    }, [refreshBalance, fetchAll]);

    if (!user) return <main className="p-6 text-center text-white/60" data-testid="vip-page">Sign in to view VIP.</main>;
    if (!me)   return <main className="p-6" data-testid="vip-page"><div className="h-32 rounded-xl bg-zinc-900/60 animate-pulse"/></main>;

    const meTierId = me.tier.tier_id;
    const pct = me.next_tier
        ? Math.min(100, Math.round(((me.lifetime_wagered_ton - me.tier.min_wagered_ton) /
                                    (me.next_tier.min_wagered_ton - me.tier.min_wagered_ton)) * 100))
        : 100;
    const curV = TIER_VISUAL[meTierId] || TIER_VISUAL[0];

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-3xl mx-auto w-full overflow-x-hidden space-y-5"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="vip-page"
        >
            {/* Hero — current tier cinematic medallion */}
            <motion.section
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: PRM() ? 0 : 0.4 }}
                className={
                    "relative rounded-3xl border overflow-hidden p-5 " +
                    `bg-gradient-to-br ${curV.accentBg} ${curV.accentBorder} ` +
                    "shadow-gold-glow-lg"
                }
                data-testid="vip-hero"
            >
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_40%,rgba(255,215,0,0.18),transparent_60%)]" />
                <div className="relative flex items-center gap-2 mb-1">
                    <Crown className="w-4 h-4 text-gold-bright" />
                    <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-gold-bright/90">VIP loyalty</span>
                </div>
                <div className="relative flex items-center gap-4">
                    <motion.div
                        whileHover={PRM() ? undefined : { rotateY: 6, rotateX: -3, scale: 1.04, transition: { duration: 0.25 } }}
                        className="relative flex-shrink-0"
                        style={{ width: 88, height: 88 }}
                    >
                        <ImageWithFallback
                            src={curV.medal}
                            alt={`${curV.name} medallion`}
                            objectFit="contain"
                            className="w-full h-full drop-shadow-[0_8px_20px_rgba(212,175,55,0.45)]"
                        />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                        <h1 className={`font-luxe text-3xl sm:text-4xl font-bold tracking-tight ${curV.accentText} leading-none`} data-testid="vip-tier-name">
                            {me.tier.name}
                        </h1>
                        <p className="text-xs text-white/70 mt-1.5">
                            Wagered · <span className="font-luxe text-gold-bright font-bold tabular-nums">{formatTON(me.lifetime_wagered_ton)} TON</span>
                        </p>
                    </div>
                </div>
                {me.next_tier && (
                    <div className="relative mt-4">
                        <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/55 font-bold mb-1">
                            <span>Next · {me.next_tier.name}</span>
                            <span data-testid="vip-to-next">{formatTON(me.to_next_tier_ton)} TON to go</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
                            <motion.div initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }}
                                style={{ width: `${pct}%` }}
                                className="h-full rounded-full bg-gradient-to-r from-gold-400 via-gold-bright to-gold-500"
                                data-testid="vip-progress-fill"/>
                        </div>
                    </div>
                )}
            </motion.section>

            {/* Perks summary */}
            <section className="rounded-xl bg-surface-1 border border-gold-500/15 p-3" data-testid="vip-perks">
                <h2 className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-2">Your perks</h2>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <PerkChip Icon={Percent} label="Rakeback" value={`${(me.tier.rakeback_bps / 100).toFixed(2)}%`} />
                    <PerkChip Icon={Sparkles} label="Daily free spins" value={`×${me.tier.daily_free_spins}`} />
                    <PerkChip Icon={TrendingUp} label="XP multiplier" value={`${(me.tier.xp_multiplier_bps / 10000).toFixed(2)}×`} />
                    <PerkChip Icon={Zap} label="Market fee discount" value={`-${(me.tier.marketplace_fee_discount_bps / 100).toFixed(2)}%`} />
                </div>
            </section>

            <button type="button" onClick={claim}
                disabled={busy || me.already_claimed_today || me.tier.rakeback_bps === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 font-bold text-sm hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-[0_8px_24px_-6px_rgba(212,175,55,0.45)]"
                data-testid="vip-claim-rakeback-btn">
                {busy ? <><Loader2 className="w-4 h-4 animate-spin"/> Claiming…</>
                      : me.already_claimed_today ? "Rakeback claimed today" :
                        <><Coins className="w-4 h-4"/> Claim daily rakeback</>}
            </button>

            {/* All-tiers cinematic grid */}
            <section data-testid="vip-tiers-table">
                <h2 className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-3 px-1">All tiers</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tiers.map((t) => {
                        const v = TIER_VISUAL[t.tier_id] || TIER_VISUAL[0];
                        const isMe   = t.tier_id === meTierId;
                        const locked = t.tier_id > meTierId;
                        return (
                            <motion.div
                                key={t.tier_id}
                                data-testid={`vip-tier-row-${t.tier_id}`}
                                whileHover={PRM() ? undefined : { y: -3, transition: { duration: 0.2 } }}
                                className={
                                    `relative overflow-hidden rounded-3xl p-4 border bg-gradient-to-br ${v.accentBg} ${v.accentBorder} ` +
                                    (isMe
                                        ? "shadow-gold-glow-lg ring-2 ring-gold-bright/45 animate-pulse"
                                        : locked
                                            ? "opacity-70 grayscale-[20%]"
                                            : "hover:shadow-gold-glow")
                                }
                            >
                                {isMe && (
                                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-gold-bright text-zinc-950 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest shadow">
                                        <Sparkles className="w-2.5 h-2.5"/> Active
                                    </span>
                                )}
                                <div className="flex flex-col items-center">
                                    <ImageWithFallback
                                        src={v.medal}
                                        alt={`${v.name} medallion`}
                                        objectFit="contain"
                                        className="w-20 h-20 drop-shadow-[0_8px_18px_rgba(212,175,55,0.4)]"
                                    />
                                    <h3 className={`font-luxe text-xl font-bold mt-1.5 ${v.accentText}`}>{t.name}</h3>
                                    <div className="font-luxe text-gold-bright tabular-nums text-sm mt-0.5">
                                        {formatTON(t.min_wagered_ton)}<span className="text-[10px] text-gold-300/65 ml-1">TON wagered</span>
                                    </div>
                                </div>
                                <ul className="mt-3 space-y-1 text-[11px] text-white/75">
                                    <li className="flex items-center gap-1.5"><Percent className="w-3 h-3 text-gold-bright"/> Rakeback <strong className="ml-auto text-gold-bright">{(t.rakeback_bps/100).toFixed(1)}%</strong></li>
                                    <li className="flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-gold-bright"/> Free spins <strong className="ml-auto text-gold-bright">×{t.daily_free_spins}</strong></li>
                                    <li className="flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-gold-bright"/> XP × <strong className="ml-auto text-gold-bright">{(t.xp_multiplier_bps/10000).toFixed(2)}</strong></li>
                                    <li className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-gold-bright"/> Fee −<strong className="ml-auto text-gold-bright">{(t.marketplace_fee_discount_bps/100).toFixed(1)}%</strong></li>
                                </ul>
                            </motion.div>
                        );
                    })}
                </div>
            </section>

            {/* Phase 11.1 — Promotion celebration modal (epic burst auto-fired) */}
            <AnimatePresence>
                {promotionFrom && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: PRM() ? 0 : 0.25 }}
                        className="fixed inset-0 z-[110] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4"
                        data-testid="vip-promotion-modal"
                        onClick={() => setPromotionFrom(null)}
                    >
                        <div
                            aria-hidden
                            className="absolute inset-0 bg-cover bg-center opacity-65 pointer-events-none"
                            style={{ backgroundImage: "url(/effects/legendary_win_burst_overlay.webp)" }}
                        />
                        <motion.div
                            initial={PRM() ? false : { scale: 0.85, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            transition={{ type: "spring", damping: 22, stiffness: 220, delay: 0.1 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-sm rounded-3xl bg-surface-1 border border-gold-bright/45 p-6 shadow-gold-glow-xl text-center"
                        >
                            <button onClick={() => setPromotionFrom(null)} className="absolute top-3 right-3 p-1.5 rounded-md text-white/55 hover:text-white" aria-label="Close" data-testid="vip-promotion-modal-close">
                                <X className="w-4 h-4"/>
                            </button>
                            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-bright font-black mb-1">VIP Promotion</div>
                            <h2 className="font-luxe text-3xl font-bold text-gold-bright">{promotionFrom.new_tier.name}</h2>
                            <p className="text-xs text-white/70 mt-1">You unlocked new perks · enjoy them.</p>
                            <ImageWithFallback
                                src={(TIER_VISUAL[promotionFrom.new_tier.tier_id] || TIER_VISUAL[0]).medal}
                                alt={`${promotionFrom.new_tier.name} medallion`}
                                objectFit="contain"
                                className="w-32 h-32 mx-auto my-4 drop-shadow-[0_12px_28px_rgba(212,175,55,0.55)]"
                            />
                            <button onClick={() => setPromotionFrom(null)} className="mt-2 px-5 py-2 rounded-lg bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 font-bold text-sm">
                                Continue
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
}


const PerkChip = ({ Icon, label, value }) => (
    <div className="rounded-md bg-black/30 border border-gold-500/15 px-2 py-1.5 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-gold-bright shrink-0" />
        <div className="min-w-0">
            <div className="text-white/45 text-[10px] uppercase tracking-wider truncate">{label}</div>
            <div className="text-gold-bright font-luxe text-sm font-bold">{value}</div>
        </div>
    </div>
);
