/**
 * Battle Pass tier card (Obsidian Vault) — free + premium reward with claim
 * buttons. Reward thumbs carry a periodic gold shine sweep; the next-up tier
 * pulses; claims pop. Locked tiers dim, claimed tiers show a check pill.
 */
import React, { useCallback } from "react";
import { motion } from "framer-motion";
import { Check, Lock, Gift, Sparkles, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { tapMedium, notifyError } from "@/lib/haptics";

const RARITY_TINT = {
    common: "rgba(140,140,151,.16)", rare: "rgba(74,143,231,.2)", epic: "rgba(47,191,143,.2)",
    legendary: "rgba(232,184,75,.22)", mythic: "rgba(224,74,107,.2)", jackpot: "rgba(168,119,230,.24)",
};

const RewardThumb = ({ reward, premium }) => {
    const { t } = useTranslation();
    if (!reward) return <div className={`v-bpthumb${premium ? " prem" : ""}`} />;

    if (reward.type === "ton") {
        return (
            <div className={`v-bpthumb${premium ? " prem" : ""}`}>
                <div className="ton"><span className="coin" /><b>{formatTON(reward.amount_ton)} TON</b></div>
            </div>
        );
    }
    if (reward.type === "free_spin") {
        return (
            <div className={`v-bpthumb${premium ? " prem" : ""}`}>
                <div className="spin">
                    <Sparkles className="w-6 h-6" aria-hidden="true" />
                    <b style={{ font: "700 13px 'JetBrains Mono'" }}>×{reward.count}</b>
                    <span style={{ font: "600 9px 'Inter'", opacity: 0.85 }}>{t("season.reward.free_spin_label")}</span>
                </div>
            </div>
        );
    }
    if (reward.type === "item") {
        // Item art is served at /api/static/items/<slug>.png (the bare
        // "items/<slug>.png" path the old code used resolves relative → 404).
        const img = resolveImage(`/api/static/items/${reward.item_slug}.png`);
        const tint = RARITY_TINT[reward.rarity] || RARITY_TINT.rare;
        return (
            <div className={`v-bpthumb${premium ? " prem" : ""}`} style={{ "--tint": tint }}>
                {img
                    ? <img src={img} alt={reward.item_name || reward.item_slug} style={{ position: "absolute", inset: 0, margin: "auto", maxWidth: "72%", maxHeight: "72%", objectFit: "contain", filter: "drop-shadow(0 5px 12px rgba(0,0,0,.55))" }} draggable={false} loading="lazy" />
                    : <Gift className="w-6 h-6" style={{ position: "absolute", inset: 0, margin: "auto", color: "var(--v-muted)" }} aria-hidden="true" />}
            </div>
        );
    }
    return <div className={`v-bpthumb${premium ? " prem" : ""}`} />;
};

const ClaimRow = ({ tier, track, labels, onClaim, disabled, claimed, locked }) => {
    const handle = useCallback(async () => {
        tapMedium();
        try { await onClaim(); } catch (_e) { notifyError(); }
    }, [onClaim]);

    if (claimed) {
        return (
            <div className="v-bppill done" data-testid={`tier-${tier}-${track}-claimed-pill`}>
                <Check className="w-3.5 h-3.5" aria-hidden="true" /> {labels.claimed}
            </div>
        );
    }
    if (locked) {
        return (
            <div className="v-bppill lock" data-testid={`tier-${tier}-${track}-locked-pill`}>
                <Lock className="w-3.5 h-3.5" aria-hidden="true" /> {labels.locked}
            </div>
        );
    }
    return (
        <motion.button
            type="button" disabled={disabled} onClick={handle}
            whileTap={{ scale: 0.94 }}
            className="v-bpclaim" data-testid={`tier-${tier}-${track}-claim-btn`}
        >
            {labels.claim}
        </motion.button>
    );
};


export default function TierCard({
    tier, xpRequired, freeReward, premiumReward, userXp, currentTier,
    premiumUnlocked, claimedFree, claimedPremium, busy, onClaim,
}) {
    const { t } = useTranslation();
    const isUnlocked = userXp >= xpRequired;
    const isCurrent = tier === currentTier + 1;   // next-up tier glow

    const labels = {
        claim: t("season.tier.claim"),
        claimed: t("season.tier.claimed"),
        locked: t("season.tier.locked"),
    };
    const cls = `v-bpcard ${isCurrent ? "current" : isUnlocked ? "unlocked" : "locked"}`;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 200px" }}
            transition={{ duration: 0.3 }}
            className={cls}
            data-testid={`tier-card-${tier}`}
        >
            <div className="v-bphead">
                <span className="lbl">{t("season.tier.label_prefix")}</span>
                <span className="n" data-testid={`tier-${tier}-number`}>{tier}</span>
            </div>

            {/* Free track */}
            <div className="v-bptrack free">
                <div className="cap"><Gift className="w-3 h-3" aria-hidden="true" /> {t("season.tier.track_free")}</div>
                <RewardThumb reward={freeReward} />
                <ClaimRow
                    tier={tier} track="free" labels={labels}
                    claimed={claimedFree} locked={!isUnlocked}
                    disabled={busy || !freeReward}
                    onClaim={() => onClaim(tier, "free")}
                />
            </div>

            {/* Premium track */}
            <div className="v-bptrack prem">
                <div className="cap"><Trophy className="w-3 h-3" aria-hidden="true" /> {t("season.tier.track_premium")}</div>
                <div className="relative">
                    <RewardThumb reward={premiumReward} premium />
                    {!premiumUnlocked && (
                        <div className="lockveil" style={{ position: "absolute", inset: 0, top: 0, bottom: 7, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(11,11,15,.66)", backdropFilter: "blur(2px)" }}>
                            <Lock className="w-5 h-5" style={{ color: "var(--v-gold)" }} aria-hidden="true" />
                        </div>
                    )}
                </div>
                <ClaimRow
                    tier={tier} track="premium" labels={labels}
                    claimed={claimedPremium} locked={!isUnlocked || !premiumUnlocked}
                    disabled={busy || !premiumReward}
                    onClaim={() => onClaim(tier, "premium")}
                />
            </div>

            <div className="v-bpfoot">{xpRequired.toLocaleString()} {t("season.xp_short")}</div>
        </motion.div>
    );
}
