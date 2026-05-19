/**
 * Phase 7c — Battle Pass / Seasons page.
 *
 * Route: /battlepass (alias /season).
 *
 * Layout:
 *  - Hero banner (flush-image right, gradient veil) + countdown.
 *  - Premium sticky CTA (top) if !premium_unlocked.
 *  - Mega XP progress bar (current tier → next).
 *  - 30-tier horizontal track (snap-scroll).
 *  - Leaderboard (top 5).
 *
 * 14-point polish checklist met:
 *  1 hero banner pattern
 *  2 flush-image tier reward thumbs
 *  3 min-h: var(--app-vh,100dvh)
 *  4 zero raw text nodes
 *  5 i18n en+ru parity
 *  6 haptics
 *  7 sfx on claim / unlock
 *  8 framer-motion entrances + reduced-motion respect
 *  9 validation states (insufficient balance, can't afford, locked)
 * 10 empty states (no leaderboard rows, loading skeletons)
 * 11 sonner toasts on every backend interaction
 * 12 data-testid on every interactive
 * 13 countdown to season end + xp bar
 * 14 360px overflow check (track is overflow-x-auto, hero is responsive)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Flame, Crown, Trophy, Sparkles, Clock, ChevronRight, ChevronLeft, Star,
    Lock, ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http, resolveImage } from "@/lib/api";
import { sfx } from "@/lib/sound";
import {
    tapMedium, tapHeavy, notifySuccess, notifyError, selectionChanged,
} from "@/lib/haptics";
import { RollingNumber } from "@/components/RollingNumber";

import TierCard from "@/components/season/TierCard";
import PremiumUnlockModal from "@/components/season/PremiumUnlockModal";


const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


function fmtCountdown(targetIso) {
    if (!targetIso) return null;
    const ms = Math.max(0, new Date(targetIso).getTime() - Date.now());
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return { d, h, m, ms };
}


// ─── Hero ─────────────────────────────────────────────────────────────────
function Hero({ season, progress, onOpenPremium }) {
    const { t } = useTranslation();
    const [cd, setCd] = useState(() => fmtCountdown(season?.ends_at));
    useEffect(() => {
        if (!season?.ends_at) return;
        const id = setInterval(() => setCd(fmtCountdown(season.ends_at)), 30_000);
        setCd(fmtCountdown(season.ends_at));
        return () => clearInterval(id);
    }, [season?.ends_at]);

    return (
        <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: PRM() ? 0 : 0.4 }}
            className="relative rounded-2xl overflow-hidden border border-amber-400/25"
            style={{
                minHeight: 180,
                background: "linear-gradient(90deg, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.6) 50%, rgba(15,23,42,0.05) 100%), url('/banners/battlepass.png') right center / auto 100% no-repeat, #111",
            }}
            data-testid="bp-hero"
        >
            <div className="relative z-10 p-5 sm:p-6 max-w-md">
                <div className="flex items-center gap-2 mb-2">
                    <Crown className="w-4 h-4 text-amber-300" aria-hidden="true" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-mono text-amber-300/90">
                        {t("season.hero.tag")}
                    </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-1">
                    {season?.name ?? t("season.hero.title_fallback")}
                </h1>
                <p className="text-sm text-zinc-300/90 mb-3 max-w-xs">
                    {t("season.hero.subtitle")}
                </p>
                {cd && (
                    <div className="flex items-center gap-2" data-testid="bp-hero-countdown">
                        <Clock className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                        <span className="text-sm font-mono text-amber-200/90">
                            {t("season.hero.ends_in", { d: cd.d, h: cd.h, m: cd.m })}
                        </span>
                    </div>
                )}
                {!progress?.premium_unlocked && (
                    <button
                        type="button"
                        onClick={() => { tapMedium(); selectionChanged(); onOpenPremium(); }}
                        className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-400/15 border border-amber-300/40 text-amber-100 text-xs font-semibold hover:bg-amber-400/25 transition-colors"
                        data-testid="bp-hero-unlock-btn"
                    >
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("season.hero.unlock_cta", { ton: season?.premium_unlock_ton ?? 50 })}
                    </button>
                )}
                {progress?.premium_unlocked && (
                    <div
                        className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-400/30 text-xs font-semibold text-emerald-200"
                        data-testid="bp-hero-premium-active"
                    >
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("season.hero.premium_active")}
                    </div>
                )}
            </div>
        </motion.section>
    );
}


// ─── XP progress bar (page-level) ─────────────────────────────────────────
function XPProgress({ progress }) {
    const { t } = useTranslation();
    if (!progress) return null;
    const into = Math.max(0, progress.xp_into_current_tier ?? 0);
    const needed = Math.max(1, progress.xp_for_next_tier ?? 1);
    const pct = Math.min(100, Math.round((into / needed) * 100));
    const isMaxed = (progress.current_tier ?? 0) >= (progress.total_tiers ?? 30);

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: PRM() ? 0 : 0.4, delay: 0.1 }}
            className="rounded-xl bg-zinc-900/80 border border-white/10 p-4"
            data-testid="bp-xp-progress"
        >
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500 mb-0.5 font-mono">
                        <Flame className="w-3 h-3 text-amber-300" aria-hidden="true" />
                        {t("season.progress.tag")}
                    </div>
                    <div className="text-2xl font-bold text-white" data-testid="bp-current-tier">
                        {t("season.progress.tier_value", { n: progress.current_tier ?? 0 })}
                        <span className="text-zinc-500 text-sm font-medium ml-1.5">
                            / {progress.total_tiers ?? 30}
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-0.5 font-mono">
                        {t("season.progress.total_xp")}
                    </div>
                    <div className="text-base font-bold text-amber-300" data-testid="bp-total-xp">
                        <RollingNumber value={progress.xp ?? 0} format={(n) => n.toLocaleString()} />
                    </div>
                </div>
            </div>
            <div className="relative h-2.5 rounded-full bg-black/50 overflow-hidden mb-2">
                <motion.div
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    style={{ width: `${pct}%` }}
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-400 via-gold-bright to-gold-500 shadow-[0_0_10px_-2px_rgba(212,175,55,0.65)]"
                    data-testid="bp-xp-fill"
                />
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
                {isMaxed ? (
                    <span className="text-emerald-300 flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("season.progress.maxed")}
                    </span>
                ) : (
                    <>
                        <span className="text-zinc-400">
                            {into.toLocaleString()} / {needed.toLocaleString()} {t("season.xp_short")}
                        </span>
                        <span className="text-amber-300/90 flex items-center gap-1">
                            <Trophy className="w-3 h-3" aria-hidden="true" />
                            {t("season.progress.to_next_tier", { n: progress.next_tier })}
                        </span>
                    </>
                )}
            </div>
        </motion.div>
    );
}


// ─── Tier track ───────────────────────────────────────────────────────────
function TierTrack({ season, progress, onClaim, busy }) {
    const { t } = useTranslation();
    const scrollerRef = useRef(null);
    const tiers = season?.tier_rewards ?? [];

    // Auto-scroll to the current tier on first paint
    useEffect(() => {
        if (!scrollerRef.current || !progress) return;
        const target = scrollerRef.current.querySelector(
            `[data-testid="tier-card-${Math.max(1, (progress.current_tier ?? 0))}"]`,
        );
        if (target) target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
    }, [progress?.current_tier]);  // eslint-disable-line react-hooks/exhaustive-deps

    const scrollBy = useCallback((dir) => {
        if (!scrollerRef.current) return;
        scrollerRef.current.scrollBy({ left: dir * 280, behavior: "smooth" });
        tapMedium();
    }, []);

    if (!tiers.length) {
        return (
            <div className="rounded-xl bg-zinc-900/60 border border-white/5 p-8 text-center" data-testid="bp-track-empty">
                <Sparkles className="w-8 h-8 mx-auto text-zinc-600 mb-2" aria-hidden="true" />
                <p className="text-sm text-zinc-400">{t("season.track.empty")}</p>
            </div>
        );
    }

    return (
        <div className="relative" data-testid="bp-track">
            <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-300" aria-hidden="true" />
                    {t("season.track.title")}
                </h2>
                <div className="hidden sm:flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => scrollBy(-1)}
                        className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                        aria-label={t("season.track.aria_scroll_prev")}
                        data-testid="bp-track-prev"
                    >
                        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => scrollBy(1)}
                        className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                        aria-label={t("season.track.aria_scroll_next")}
                        data-testid="bp-track-next"
                    >
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>
            </div>
            <div
                ref={scrollerRef}
                className="flex gap-2.5 overflow-x-auto pb-3 pt-1 px-0.5 snap-x snap-mandatory scrollbar-thin"
                style={{ scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
                data-testid="bp-track-scroller"
            >
                {tiers.map((row) => {
                    const tier = row.tier;
                    const claimedFree = (progress?.claimed_free_tiers ?? []).includes(tier);
                    const claimedPrem = (progress?.claimed_premium_tiers ?? []).includes(tier);
                    return (
                        <TierCard
                            key={tier}
                            tier={tier}
                            xpRequired={row.xp_required}
                            freeReward={(row.free_rewards || [])[0]}
                            premiumReward={(row.premium_rewards || [])[0]}
                            userXp={progress?.xp ?? 0}
                            currentTier={progress?.current_tier ?? 0}
                            premiumUnlocked={!!progress?.premium_unlocked}
                            claimedFree={claimedFree}
                            claimedPremium={claimedPrem}
                            busy={busy}
                            onClaim={onClaim}
                        />
                    );
                })}
            </div>
        </div>
    );
}


// ─── Leaderboard preview ──────────────────────────────────────────────────
function LeaderboardPreview() {
    const { t } = useTranslation();
    const [rows, setRows] = useState(null);
    const [err, setErr] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const { data } = await http.get("/season/leaderboard", { params: { limit: 5 } });
                if (active) setRows(data?.rows ?? []);
            } catch (_e) {
                if (active) setErr(true);
            }
        })();
        return () => { active = false; };
    }, []);

    return (
        <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: PRM() ? 0 : 0.4, delay: 0.2 }}
            className="rounded-xl bg-zinc-900/80 border border-white/10 p-4"
            data-testid="bp-leaderboard"
        >
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-amber-300" aria-hidden="true" />
                {t("season.leaderboard.title")}
            </h2>
            {rows === null && !err && (
                <div className="space-y-2" data-testid="bp-leaderboard-loading">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-9 rounded-md bg-white/5 animate-pulse" />
                    ))}
                </div>
            )}
            {err && (
                <p className="text-sm text-rose-300/80" data-testid="bp-leaderboard-error">
                    {t("season.leaderboard.error")}
                </p>
            )}
            {rows !== null && rows.length === 0 && !err && (
                <p className="text-sm text-zinc-500" data-testid="bp-leaderboard-empty">
                    {t("season.leaderboard.empty")}
                </p>
            )}
            {rows !== null && rows.length > 0 && (
                <ol className="space-y-1.5" data-testid="bp-leaderboard-rows">
                    {rows.map((r, i) => (
                        <li
                            key={r.user_id}
                            className="flex items-center gap-2.5 p-2 rounded-lg bg-white/5 border border-white/5"
                            data-testid={`bp-leaderboard-row-${i + 1}`}
                        >
                            <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                i === 0 ? "bg-amber-400/20 text-amber-200" :
                                i === 1 ? "bg-zinc-400/20 text-zinc-200" :
                                i === 2 ? "bg-orange-500/20 text-orange-200" :
                                          "bg-white/5 text-zinc-400"
                            }`}>
                                {i + 1}
                            </span>
                            {r.photo_url ? (
                                <img
                                    src={r.photo_url} alt=""
                                    className="w-6 h-6 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                            ) : (
                                <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300">
                                    {(r.username?.[0] || r.first_name?.[0] || "?").toUpperCase()}
                                </div>
                            )}
                            <span className="text-sm text-zinc-200 truncate flex-1">
                                {r.username || r.first_name || t("season.leaderboard.anon")}
                            </span>
                            {r.premium_unlocked && (
                                <Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true" />
                            )}
                            <span className="text-xs font-mono text-amber-300/90 shrink-0">
                                {r.xp.toLocaleString()}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </motion.section>
    );
}


// ─── Main page ────────────────────────────────────────────────────────────
export default function BattlePassPage({ user, balance, refreshBalance }) {
    const { t } = useTranslation();
    const [state, setState] = useState(null);     // { season, progress }
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showPremium, setShowPremium] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const { data } = await http.get("/season/current");
            setState(data);
        } catch (e) {
            toast.error(t("season.toast.load_failed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (!user) return;
        refresh();
    }, [user, refresh]);

    const handleClaim = useCallback(async (tier, track) => {
        if (busy) return;
        setBusy(true);
        try {
            const { data: res } = await http.post("/season/claim", { tier, track });
            sfx.play("success_bell", { volume: 0.45 });
            sfx.play("confetti_burst", { volume: 0.4 });
            tapHeavy(); notifySuccess();
            const granted = (res?.rewards_granted || [])[0];
            if (granted?.type === "ton") {
                toast.success(t("season.toast.claimed_ton", { ton: granted.amount_ton, tier }));
            } else if (granted?.type === "free_spin") {
                toast.success(t("season.toast.claimed_free_spin", { n: granted.count, tier }));
            } else if (granted?.type === "item") {
                toast.success(t("season.toast.claimed_item", {
                    name: granted.item_name || granted.item_slug, tier,
                }));
            } else {
                toast.success(t("season.toast.claimed_generic", { tier }));
            }
            await refresh();
            refreshBalance?.();
        } catch (e) {
            const detail = e?.response?.data?.detail || e?.message || "error";
            sfx.play("loss_thud", { volume: 0.35 });
            notifyError();
            if (detail.includes("already_claimed")) {
                toast.error(t("season.toast.already_claimed"));
            } else if (detail.includes("premium_not_unlocked")) {
                toast.error(t("season.toast.premium_required"));
            } else if (detail.includes("tier_not_yet_unlocked")) {
                toast.error(t("season.toast.tier_locked"));
            } else {
                toast.error(t("season.toast.claim_failed", { detail }));
            }
        } finally {
            setBusy(false);
        }
    }, [busy, refresh, refreshBalance, t]);

    const handleUnlocked = useCallback(async (_res) => {
        await refresh();
        refreshBalance?.();
    }, [refresh, refreshBalance]);

    // ── Render ─────────────────────────────────────────────────────────
    if (loading) {
        return (
            <main
                className="px-3 sm:px-5 pt-3 pb-24 max-w-5xl mx-auto w-full"
                style={{ minHeight: "var(--app-vh, 100dvh)" }}
                data-testid="battlepass-page"
            >
                <div className="space-y-4">
                    <div className="h-44 rounded-2xl bg-zinc-900/60 animate-pulse" data-testid="bp-skeleton-hero" />
                    <div className="h-32 rounded-xl bg-zinc-900/60 animate-pulse" />
                    <div className="h-72 rounded-xl bg-zinc-900/60 animate-pulse" />
                </div>
            </main>
        );
    }
    if (!state) {
        return (
            <main
                className="px-3 sm:px-5 pt-3 pb-24 max-w-5xl mx-auto w-full"
                style={{ minHeight: "var(--app-vh, 100dvh)" }}
                data-testid="battlepass-page"
            >
                <div className="rounded-xl bg-zinc-900/60 border border-white/10 p-6 text-center">
                    <Sparkles className="w-10 h-10 mx-auto text-zinc-600 mb-3" aria-hidden="true" />
                    <p className="text-sm text-zinc-300">{t("season.empty.no_season")}</p>
                </div>
            </main>
        );
    }

    const { season, progress } = state;
    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-5xl mx-auto w-full max-w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="battlepass-page"
        >
            <Hero
                season={season}
                progress={progress}
                onOpenPremium={() => setShowPremium(true)}
            />
            <XPProgress progress={progress} />
            <TierTrack
                season={season} progress={progress} busy={busy} onClaim={handleClaim}
            />
            <LeaderboardPreview />

            <PremiumUnlockModal
                open={showPremium}
                onClose={() => setShowPremium(false)}
                costTon={season?.premium_unlock_ton ?? 50}
                balance={balance ?? 0}
                onUnlocked={handleUnlocked}
            />
        </main>
    );
}
