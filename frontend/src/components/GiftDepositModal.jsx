/**
 * Phase 6e — GiftDepositModal
 *
 * Lets a logged-in user request a deposit "intent" for transferring a real
 * Telegram NFT gift into the vault. The intent contains:
 *   - vault TON address (display only — gifts are sent through the gift transfer UI)
 *   - unique memo (e.g. gd_<userId>_<nonce>) that the user MUST attach as
 *     the comment when transferring the NFT
 *   - 30-min countdown
 *
 * After the user transfers, the watcher (or admin) flips status pending → fulfilled
 * and the won item appears in their inventory. We long-poll every 4s for up to 30 min.
 *
 * Tested via the admin /api/admin/gift-deposits/test-credit endpoint, since
 * real on-chain NFT transfers cannot be simulated in CI.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
    Copy, X, Gift, Loader2, CheckCircle2, Clock, AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    createGiftDepositIntent,
    fetchGiftDepositIntent,
    resolveImage,
} from "@/lib/api";
import { tapLight, notifySuccess } from "@/lib/haptics";
import { sfx } from "@/lib/sound";

function shorten(addr) {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function fmtCountdown(ms) {
    if (ms <= 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export const GiftDepositModal = ({ open, onClose, onFulfilled }) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [intent, setIntent] = useState(null);
    const [now, setNow] = useState(Date.now());
    // Phase 11.2.5 — error state.  Previously, if createGiftDepositIntent()
    // threw (network blip, expired token, backend hiccup), the catch block
    // called onClose() and the user saw the modal slam shut with no visible
    // feedback — exactly the "click does nothing" symptom reported on prod.
    // Now we keep the modal open and surface the error + a Retry button.
    const [error, setError] = useState(null);
    const pollRef = useRef(null);

    const createIntent = async () => {
        setLoading(true);
        setIntent(null);
        setError(null);
        try {
            const d = await createGiftDepositIntent();
            return d;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error("[gift_deposit] createGiftDepositIntent failed:", e);
            const msg = e?.response?.data?.detail || e?.message || "network_error";
            setError(msg);
            // Still surface a toast for users who DID see the modal opening
            // briefly, but DO NOT call onClose() — keep the modal open with
            // the error state so they can retry.
            toast.error(t("gift_deposit.create_failed"), { description: msg });
            return null;
        } finally {
            setLoading(false);
        }
    };

    // Generate intent on open
    useEffect(() => {
        if (!open) {
            // Reset state on close so a stale error from the previous open
            // doesn't flash when the user reopens.
            setError(null);
            setIntent(null);
            return;
        }
        // Phase 6i — modal open whoosh
        try { sfx.play("modal_whoosh", { volume: 0.55 }); } catch { /* iOS audio context */ }
        let cancelled = false;
        (async () => {
            const d = await createIntent();
            if (!cancelled && d) setIntent(d);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Tick once per second for the countdown
    useEffect(() => {
        if (!open || !intent) return;
        const i = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(i);
    }, [open, intent]);

    // Long-poll the intent every 4s while pending
    useEffect(() => {
        if (!open || !intent?.id) return;
        if (intent.status !== "pending") return;
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            try {
                const fresh = await fetchGiftDepositIntent(intent.id);
                setIntent(fresh);
                if (fresh.status === "fulfilled") {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    notifySuccess();
                    // "Coin shower" — chained chimes for big-feeling credit
                    sfx.play("coin_drop", { volume: 0.7 });
                    setTimeout(() => sfx.play("coin_drop", { volume: 0.55 }), 220);
                    setTimeout(() => sfx.playWin(fresh.item_rarity || "rare"), 480);
                    toast.success(t("gift_deposit.credited_title"), {
                        description: fresh.item_name
                            ? t("gift_deposit.credited_with_item", { item: fresh.item_name })
                            : t("gift_deposit.credited_default"),
                    });
                    onFulfilled?.(fresh);
                } else if (fresh.status === "expired" || fresh.status === "rejected") {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            } catch { /* ignore transient */ }
        }, 4000);
        return () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        };
    }, [open, intent?.id, intent?.status, t, onFulfilled]);

    const expiresMs = useMemo(() => {
        if (!intent?.expires_at) return 0;
        return new Date(intent.expires_at).getTime() - now;
    }, [intent, now]);

    const copy = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            tapLight();
            toast.success(label, { duration: 1500 });
        } catch {
            toast.error(t("common.copy_failed"));
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    data-testid="gift-deposit-overlay"
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        data-testid="gift-deposit-modal"
                        className="relative w-full sm:max-w-md bg-cyber-surface border border-cyber-purple/30 rounded-t-3xl sm:rounded-3xl p-6 shadow-[0_-10px_60px_rgba(138,43,226,0.25)] max-h-[90vh] overflow-y-auto"
                        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 28, stiffness: 280 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            data-testid="gift-deposit-close"
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
                            aria-label={t("common.close")}
                        >
                            <X className="w-4 h-4 text-white/70" />
                        </button>

                        <div className="flex items-center gap-3 mb-5">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyber-purple/20 to-cyber-cyan/20 border border-white/10">
                                <Gift className="w-5 h-5 text-cyber-purple" />
                            </div>
                            <div>
                                <h2 className="font-display text-xl font-bold leading-none">
                                    {t("gift_deposit.title")}
                                </h2>
                                <p className="text-xs text-white/50 mt-1">
                                    {t("gift_deposit.subtitle")}
                                </p>
                            </div>
                        </div>

                        {loading ? (
                            <div className="py-12 flex items-center justify-center text-white/50">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                {t("gift_deposit.preparing")}
                            </div>
                        ) : error && !intent ? (
                            // Phase 11.2.5 — visible error state instead of
                            // silent onClose() so the user can see WHY the
                            // gift-deposit flow couldn't start and retry.
                            <div
                                data-testid="gift-deposit-error"
                                className="py-8 flex flex-col items-center text-center gap-3"
                            >
                                <div className="p-3 rounded-full bg-red-500/15 border border-red-500/40">
                                    <AlertTriangle className="w-9 h-9 text-red-400" />
                                </div>
                                <h3 className="font-display text-xl font-bold">
                                    {t("gift_deposit.create_failed")}
                                </h3>
                                <p className="text-xs text-white/55 break-words max-w-full px-2 font-mono">
                                    {String(error).slice(0, 200)}
                                </p>
                                <p className="text-[11px] text-white/40">
                                    {t("gift_deposit.error_hint", { defaultValue: "Please check your connection and try again. If the issue persists, re-login from Profile." })}
                                </p>
                                <button
                                    data-testid="gift-deposit-error-retry"
                                    onClick={async () => {
                                        const d = await createIntent();
                                        if (d) setIntent(d);
                                    }}
                                    className="mt-2 w-full bg-gradient-to-r from-cyber-purple to-cyber-cyan text-cyber-bg font-display font-bold rounded-xl py-3 uppercase tracking-wider"
                                >
                                    {t("gift_deposit.try_again")}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="text-xs text-white/45 hover:text-white/70 underline"
                                >
                                    {t("common.close")}
                                </button>
                            </div>
                        ) : !intent ? (
                            <div className="py-12 flex items-center justify-center text-white/50">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                {t("gift_deposit.preparing")}
                            </div>
                        ) : intent.status === "fulfilled" ? (
                            <div
                                data-testid="gift-deposit-fulfilled"
                                className="py-8 flex flex-col items-center text-center gap-3"
                            >
                                <div className="p-3 rounded-full bg-cyber-cyan/20 border border-cyber-cyan/40">
                                    <CheckCircle2 className="w-10 h-10 text-cyber-cyan" />
                                </div>
                                <h3 className="font-display text-2xl font-black">
                                    {t("gift_deposit.credited_title")}
                                </h3>
                                {intent.image_url && (
                                    <img
                                        src={resolveImage(intent.image_url)}
                                        alt={intent.item_name || ""}
                                        className="w-24 h-24 object-contain my-2 drop-shadow-[0_0_18px_rgba(56,182,255,0.55)]"
                                        draggable={false}
                                    />
                                )}
                                <p className="text-sm text-white/70">
                                    {intent.item_name || t("gift_deposit.credited_default")}
                                </p>
                                <button
                                    data-testid="gift-deposit-done"
                                    onClick={onClose}
                                    className="mt-4 w-full bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-display font-bold rounded-xl py-3 uppercase tracking-wider"
                                >
                                    {t("common.ok")}
                                </button>
                            </div>
                        ) : intent.status === "expired" || intent.status === "rejected" ? (
                            <div className="py-8 flex flex-col items-center text-center gap-3">
                                <div className="p-3 rounded-full bg-yellow-500/15 border border-yellow-500/40">
                                    <AlertTriangle className="w-9 h-9 text-yellow-400" />
                                </div>
                                <h3 className="font-display text-xl font-bold">
                                    {intent.status === "expired"
                                        ? t("gift_deposit.expired_title")
                                        : t("gift_deposit.rejected_title")}
                                </h3>
                                <p className="text-sm text-white/60">
                                    {t("gift_deposit.expired_sub")}
                                </p>
                                <button
                                    data-testid="gift-deposit-retry"
                                    onClick={async () => {
                                        setLoading(true);
                                        try {
                                            const d = await createGiftDepositIntent();
                                            setIntent(d);
                                        } catch (e) {
                                            toast.error(t("gift_deposit.create_failed"), {
                                                description: e?.response?.data?.detail || e?.message,
                                            });
                                        } finally {
                                            setLoading(false);
                                        }
                                    }}
                                    className="w-full bg-gradient-to-r from-cyber-purple to-cyber-cyan text-cyber-bg font-display font-bold rounded-xl py-3 uppercase tracking-wider"
                                >
                                    {t("gift_deposit.try_again")}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* COUNTDOWN */}
                                <div
                                    data-testid="gift-deposit-countdown"
                                    className="flex items-center gap-2 bg-cyber-bg border border-cyber-cyan/30 rounded-xl px-3 py-2"
                                >
                                    <Clock className="w-4 h-4 text-cyber-cyan" />
                                    <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-cyber-cyan/80">
                                        {t("gift_deposit.expires_in")}
                                    </div>
                                    <div className="ml-auto font-mono font-black tabular-nums text-cyber-cyan text-base">
                                        {fmtCountdown(expiresMs)}
                                    </div>
                                </div>

                                {/* VAULT ADDRESS */}
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1.5">
                                        {t("gift_deposit.vault_address")}
                                    </div>
                                    <div
                                        data-testid="gift-deposit-address-box"
                                        onClick={() => copy(intent.address, t("gift_deposit.address_copied"))}
                                        className="flex items-center justify-between gap-2 bg-cyber-bg border border-white/10 rounded-xl p-3 cursor-pointer hover:border-cyber-cyan/40 transition"
                                    >
                                        <span className="font-mono text-xs text-white truncate">
                                            {shorten(intent.address)}
                                        </span>
                                        <Copy className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
                                    </div>
                                </div>

                                {/* MEMO */}
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyber-purple mb-1.5">
                                        {t("gift_deposit.memo_label")}
                                    </div>
                                    <div
                                        data-testid="gift-deposit-memo-box"
                                        onClick={() => copy(intent.memo, t("gift_deposit.memo_copied"))}
                                        className="flex items-center justify-between gap-2 bg-cyber-bg border border-cyber-purple/40 rounded-xl p-3 cursor-pointer hover:border-cyber-purple/70 transition"
                                    >
                                        <span className="font-mono text-xs text-cyber-purple truncate font-bold">
                                            {intent.memo}
                                        </span>
                                        <Copy className="w-4 h-4 text-cyber-purple flex-shrink-0" />
                                    </div>
                                    <p className="text-[10px] text-yellow-400/80 mt-1.5 leading-relaxed">
                                        {t("gift_deposit.memo_warn")}
                                    </p>
                                </div>

                                {/* STEPS */}
                                <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
                                        {t("gift_deposit.steps_title")}
                                    </div>
                                    <ol className="text-[11px] text-white/75 leading-relaxed list-decimal pl-4 space-y-1">
                                        <li>{t("gift_deposit.step_1")}</li>
                                        <li>{t("gift_deposit.step_2")}</li>
                                        <li>{t("gift_deposit.step_3")}</li>
                                        <li>{t("gift_deposit.step_4")}</li>
                                    </ol>
                                </div>

                                {/* POLLING INDICATOR */}
                                <div
                                    data-testid="gift-deposit-polling"
                                    className="flex items-center justify-center gap-2 text-[11px] text-white/50"
                                >
                                    <Loader2 className="w-3 h-3 animate-spin text-cyber-cyan" />
                                    <span>{t("gift_deposit.waiting")}</span>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GiftDepositModal;
