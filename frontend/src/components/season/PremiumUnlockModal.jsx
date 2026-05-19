/**
 * Phase 7c — Premium Unlock Modal
 *
 * Clear breakdown of what unlock gets the user + big confirm CTA.
 * On confirm: debit 50 TON, retroactive flag flips. Confetti + haptics on success.
 */
import React, { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lock, Crown, Coins, Sparkles, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifySuccess, notifyError } from "@/lib/haptics";


export default function PremiumUnlockModal({
    open, onClose, costTon, balance, onUnlocked,
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);

    const canAfford = (balance ?? 0) >= (costTon ?? 50);

    const handleConfirm = useCallback(async () => {
        if (!canAfford) {
            sfx.play("loss_thud", { volume: 0.4 });
            notifyError();
            toast.error(t("season.premium.toast_insufficient"));
            return;
        }
        setBusy(true);
        tapMedium();
        try {
            const res = await http.post("/season/unlock-premium");
            const payload = res?.data ?? res;
            sfx.play("confetti_burst", { volume: 0.6 });
            sfx.play("success_bell", { volume: 0.45 });
            tapHeavy(); notifySuccess();
            toast.success(t("season.premium.toast_unlocked"));
            onUnlocked?.(payload);
            onClose?.();
        } catch (e) {
            const detail = e?.response?.data?.detail || e?.message || "error";
            sfx.play("loss_thud", { volume: 0.4 });
            notifyError();
            toast.error(t("season.premium.toast_error", { detail }));
        } finally {
            setBusy(false);
        }
    }, [canAfford, onClose, onUnlocked, t]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="fixed inset-0 z-[60] bg-zinc-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                    onClick={onClose}
                    data-testid="premium-unlock-modal"
                >
                    <motion.div
                        initial={{ y: 32, opacity: 0, scale: 0.96 }}
                        animate={{ y: 0,  opacity: 1, scale: 1 }}
                        exit={{ y: 16, opacity: 0, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-md rounded-2xl bg-zinc-900 border border-amber-400/30 shadow-2xl overflow-hidden"
                    >
                        {/* Header band */}
                        <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-amber-500/20 via-amber-400/10 to-transparent border-b border-amber-400/20">
                            <button
                                type="button"
                                onClick={onClose}
                                className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                                data-testid="premium-unlock-close-btn"
                                aria-label={t("season.premium.aria_close")}
                            >
                                <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <div className="flex items-center gap-2 mb-1.5">
                                <Crown className="w-5 h-5 text-amber-300" aria-hidden="true" />
                                <span className="text-[11px] font-mono uppercase tracking-widest text-amber-300/80">
                                    {t("season.premium.tag")}
                                </span>
                            </div>
                            <h2 className="text-xl font-bold text-white" data-testid="premium-unlock-title">
                                {t("season.premium.title")}
                            </h2>
                            <p className="text-sm text-zinc-400 mt-1">
                                {t("season.premium.subtitle")}
                            </p>
                        </div>

                        {/* Benefits */}
                        <ul className="px-5 py-4 space-y-2.5">
                            {[
                                { icon: Sparkles, key: "season.premium.benefit_30_tiers" },
                                { icon: Coins,    key: "season.premium.benefit_retroactive" },
                                { icon: Crown,    key: "season.premium.benefit_legendary" },
                            ].map(({ icon: Icon, key }) => (
                                <li key={key} className="flex items-start gap-2.5">
                                    <div className="shrink-0 w-7 h-7 rounded-md bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                                        <Icon className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                                    </div>
                                    <span className="text-sm text-zinc-200 leading-snug">
                                        {t(key)}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        {/* Confirm row */}
                        <div className="px-5 pb-5">
                            <div className="flex items-center justify-between mb-3 px-3 py-2.5 rounded-lg bg-black/40 border border-white/10">
                                <span className="text-sm text-zinc-400">{t("season.premium.price_label")}</span>
                                <span className="text-base font-bold text-amber-300" data-testid="premium-unlock-cost">
                                    {costTon ?? 50} TON
                                </span>
                            </div>
                            {!canAfford && (
                                <div
                                    className="mb-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200"
                                    data-testid="premium-unlock-insufficient"
                                >
                                    {t("season.premium.insufficient_balance", { needed: (costTon ?? 50) - (balance ?? 0) })}
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={busy || !canAfford}
                                className="w-full py-3 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-bold text-sm shadow-lg hover:from-amber-300 hover:to-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                data-testid="premium-unlock-confirm-btn"
                            >
                                {busy ? (
                                    <>
                                        <span className="w-3 h-3 rounded-full border-2 border-amber-950 border-t-transparent animate-spin" aria-hidden="true" />
                                        {t("season.premium.confirming")}
                                    </>
                                ) : (
                                    <>
                                        <Lock className="w-4 h-4" aria-hidden="true" />
                                        {t("season.premium.confirm_cta", { cost: costTon ?? 50 })}
                                    </>
                                )}
                            </button>
                            <p className="mt-2 text-center text-[11px] text-zinc-500">
                                {t("season.premium.fine_print")}
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
