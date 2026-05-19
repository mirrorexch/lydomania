/**
 * Phase 7c — Tier Card for the Battle Pass track.
 *
 * Each card shows free + premium rewards for a single tier with claim
 * buttons. Locked tiers are dimmed; claimed tiers have a check overlay.
 *
 * Polish:
 *  - flush-image reward thumbs (absolute inset-0 object-cover)
 *  - data-testid per actionable element
 *  - haptics + sfx on claim
 *  - sonner toast for errors
 */
import React, { useCallback } from "react";
import { motion } from "framer-motion";
import { Check, Lock, Coins, Gift, Sparkles, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, notifySuccess, notifyError } from "@/lib/haptics";
import { GiftCard } from "@/components/common/GiftCard";


const RewardThumb = ({ reward }) => {
    const { t } = useTranslation();
    if (!reward) return null;
    if (reward.type === "ton") {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-400/15 to-amber-600/30">
                <Coins className="w-7 h-7 text-amber-300 mb-1" aria-hidden="true" />
                <span className="text-xs font-semibold text-amber-100">{formatTON(reward.amount_ton)}</span>
            </div>
        );
    }
    if (reward.type === "free_spin") {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-cyan-400/15 to-cyan-600/30">
                <Sparkles className="w-7 h-7 text-cyan-300 mb-1" aria-hidden="true" />
                <span className="text-xs font-semibold text-cyan-100">×{reward.count}</span>
                <span className="text-[10px] leading-none mt-0.5 text-cyan-200/80">
                    {t("season.reward.free_spin_label")}
                </span>
            </div>
        );
    }
    if (reward.type === "item") {
        // Phase 11.1 — Unified <GiftCard size="sm"> as the source of truth.
        const itemForCard = {
            id: `tier-reward-${reward.item_slug}`,
            item_name: reward.item_name || reward.item_slug,
            item_slug: reward.item_slug,
            image_url: `items/${reward.item_slug}.png`,
            rarity: reward.rarity || "rare",
            payout_ton: reward.floor_ton || 0,
        };
        return (
            <div className="absolute inset-0 flex items-center justify-center">
                <GiftCard
                    item={itemForCard}
                    size="sm"
                    className="!w-full !h-full"
                />
            </div>
        );
    }
    return null;
};


const ClaimButton = ({ tier, track, label, onClaim, disabled, claimed, locked }) => {
    const handle = useCallback(async () => {
        tapMedium();
        try {
            await onClaim();
        } catch (_e) {
            notifyError();
        }
    }, [onClaim]);

    if (claimed) {
        return (
            <div
                className="flex items-center justify-center w-full py-1 rounded-md bg-emerald-500/15 border border-emerald-400/40 text-[11px] font-semibold text-emerald-200"
                data-testid={`tier-${tier}-${track}-claimed-pill`}
            >
                <Check className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                {label.claimed}
            </div>
        );
    }
    if (locked) {
        return (
            <div
                className="flex items-center justify-center w-full py-1 rounded-md bg-white/5 border border-white/10 text-[11px] font-medium text-zinc-500"
                data-testid={`tier-${tier}-${track}-locked-pill`}
            >
                <Lock className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                {label.locked}
            </div>
        );
    }
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={handle}
            className="w-full py-1 rounded-md bg-gradient-to-r from-emerald-400 to-emerald-500 text-[11px] font-semibold text-emerald-950 hover:from-emerald-300 hover:to-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`tier-${tier}-${track}-claim-btn`}
        >
            {label.claim}
        </button>
    );
};


export default function TierCard({
    tier,
    xpRequired,
    freeReward,
    premiumReward,
    userXp,
    currentTier,
    premiumUnlocked,
    claimedFree,
    claimedPremium,
    busy,
    onClaim,
}) {
    const { t } = useTranslation();
    const isUnlocked = userXp >= xpRequired;
    const isCurrent  = tier === currentTier + 1;   // next-up tier glow

    const buttonLabels = {
        claim:   t("season.tier.claim"),
        claimed: t("season.tier.claimed"),
        locked:  t("season.tier.locked"),
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={`relative shrink-0 w-[260px] sm:w-[280px] rounded-xl border overflow-hidden snap-start ${
                isCurrent
                    ? "border-amber-300/60 shadow-[0_0_24px_-8px_rgba(251,191,36,0.45)]"
                    : isUnlocked
                        ? "border-white/15"
                        : "border-white/5 opacity-70"
            } bg-zinc-900/80 backdrop-blur-sm`}
            data-testid={`tier-card-${tier}`}
        >
            {/* Tier header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 border-b border-white/5">
                <span className="text-[11px] font-mono tracking-widest text-zinc-400">
                    {t("season.tier.label_prefix")}
                </span>
                <span
                    className={`text-sm font-bold ${
                        isCurrent ? "text-amber-300" : "text-white"
                    }`}
                    data-testid={`tier-${tier}-number`}
                >
                    {tier}
                </span>
            </div>

            {/* Free track */}
            <div className="px-2 pt-2 pb-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1">
                    <Gift className="w-3 h-3" aria-hidden="true" />
                    {t("season.tier.track_free")}
                </div>
                <div className="relative aspect-square rounded-md overflow-hidden border border-white/10 bg-zinc-950 mb-1.5">
                    <RewardThumb reward={freeReward} />
                </div>
                <ClaimButton
                    tier={tier} track="free"
                    label={buttonLabels}
                    claimed={claimedFree}
                    locked={!isUnlocked}
                    disabled={busy || !freeReward}
                    onClaim={() => onClaim(tier, "free")}
                />
            </div>

            {/* Premium track */}
            <div className="px-2 pb-2 pt-1 border-t border-white/5">
                <div className="text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1 text-amber-300/90">
                    <Trophy className="w-3 h-3" aria-hidden="true" />
                    {t("season.tier.track_premium")}
                </div>
                <div className="relative aspect-square rounded-md overflow-hidden border border-amber-400/20 bg-gradient-to-br from-zinc-950 to-zinc-900 mb-1.5">
                    <RewardThumb reward={premiumReward} />
                    {!premiumUnlocked && (
                        <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-[2px] flex items-center justify-center">
                            <Lock className="w-5 h-5 text-amber-300/70" aria-hidden="true" />
                        </div>
                    )}
                </div>
                <ClaimButton
                    tier={tier} track="premium"
                    label={buttonLabels}
                    claimed={claimedPremium}
                    locked={!isUnlocked || !premiumUnlocked}
                    disabled={busy || !premiumReward}
                    onClaim={() => onClaim(tier, "premium")}
                />
            </div>

            {/* XP requirement footer */}
            <div className="px-3 py-1 bg-black/40 border-t border-white/5 text-center">
                <span className="text-[10px] font-mono text-zinc-500">
                    {xpRequired.toLocaleString()} {t("season.xp_short")}
                </span>
            </div>
        </motion.div>
    );
}
