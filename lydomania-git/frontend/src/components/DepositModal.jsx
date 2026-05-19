import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { beginCell, toNano, Address } from "@ton/core";
import { Copy, X, Diamond, ArrowDownToLine, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchDepositAddress, fetchBalance } from "@/lib/api";

const PRESETS = [10, 25, 50, 100, 250];

function shorten(addr) {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export const DepositModal = ({ open, onClose, onCredited, currentBalance }) => {
    const { t } = useTranslation();
    const [tonConnectUI] = useTonConnectUI();
    const walletAddress = useTonAddress();

    const [loadingIntent, setLoadingIntent] = useState(false);
    const [intent, setIntent] = useState(null);
    const [amount, setAmount] = useState(10);
    const [sending, setSending] = useState(false);
    const [polling, setPolling] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            setLoadingIntent(true);
            try {
                const d = await fetchDepositAddress();
                if (!cancelled) setIntent(d);
            } catch (e) {
                toast.error(t("deposit_modal.address_load_failed"), {
                    description: e?.message || t("deposit_modal.try_again"),
                });
            } finally {
                if (!cancelled) setLoadingIntent(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, t]);

    const expiresLabel = useMemo(() => {
        if (!intent?.expires_at) return "";
        const exp = new Date(intent.expires_at).getTime();
        const mins = Math.max(0, Math.floor((exp - Date.now()) / 60000));
        return t("deposit_modal.minutes_short", { n: mins });
    }, [intent, t]);

    const copy = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(label, { duration: 1500 });
        } catch {
            toast.error(t("common.copy_failed"));
        }
    };

    const handlePay = async () => {
        if (!intent) return;
        if (!walletAddress) {
            tonConnectUI.openModal();
            return;
        }
        const amt = Number(amount);
        if (!amt || amt <= 0) {
            toast.error(t("deposit_modal.amount_invalid"));
            return;
        }

        setSending(true);
        try {
            const payload = beginCell()
                .storeUint(0, 32)
                .storeStringTail(intent.memo)
                .endCell()
                .toBoc()
                .toString("base64");

            const dest = Address.parse(intent.address).toString({
                bounceable: false, urlSafe: true, testOnly: false,
            });

            await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 360,
                messages: [{ address: dest, amount: toNano(amt.toString()).toString(), payload }],
            });

            toast.success(t("deposit_modal.tx_sent_title"), {
                description: t("deposit_modal.tx_sent_subtitle", { amount: amt }),
            });
            setPolling(true);
            const startedAt = Date.now();
            const initialBal = Number(currentBalance || 0);
            const interval = setInterval(async () => {
                try {
                    const b = await fetchBalance();
                    if (b > initialBal + amt * 0.999) {
                        clearInterval(interval);
                        setPolling(false);
                        toast.success(t("deposit_modal.credited_title"), {
                            description: t("deposit_modal.credited_subtitle", { amount: amt }),
                        });
                        onCredited?.(b);
                        onClose?.();
                    } else if (Date.now() - startedAt > 120000) {
                        clearInterval(interval);
                        setPolling(false);
                        toast.message(t("deposit_modal.still_waiting"), {
                            description: t("deposit_modal.still_waiting_sub"),
                        });
                    }
                } catch { /* ignore */ }
            }, 5000);
        } catch (e) {
            const msg = e?.message || t("deposit_modal.tx_failed_default");
            toast.error(t("deposit_modal.tx_failed"), { description: msg });
        } finally {
            setSending(false);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    data-testid="deposit-modal-overlay"
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        data-testid="deposit-modal"
                        className="relative w-full sm:max-w-md bg-cyber-surface border border-cyber-purple/30 rounded-t-3xl sm:rounded-3xl p-6 shadow-[0_-10px_60px_rgba(138,43,226,0.25)]"
                        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 28, stiffness: 280 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            data-testid="deposit-modal-close"
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
                        >
                            <X className="w-4 h-4 text-white/70" />
                        </button>

                        <div className="flex items-center gap-3 mb-5">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyber-cyan/20 to-cyber-purple/20 border border-white/10">
                                <ArrowDownToLine className="w-5 h-5 text-cyber-cyan" />
                            </div>
                            <div>
                                <h2 className="font-display text-xl font-bold leading-none">
                                    {t("deposit_modal.title")}
                                </h2>
                                <p className="text-xs text-white/50 mt-1">
                                    {t("deposit_modal.subtitle")}
                                </p>
                            </div>
                        </div>

                        {loadingIntent || !intent ? (
                            <div className="py-12 flex items-center justify-center text-white/50">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                {t("deposit_modal.preparing")}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1.5">
                                        {t("deposit_modal.vault_address")}
                                    </div>
                                    <div
                                        data-testid="vault-address-box"
                                        onClick={() => copy(intent.address, t("deposit_modal.address_copied"))}
                                        className="flex items-center justify-between gap-2 bg-cyber-bg border border-white/10 rounded-xl p-3 cursor-pointer hover:border-cyber-cyan/40 transition"
                                    >
                                        <span className="font-mono text-xs text-white truncate">
                                            {shorten(intent.address)}
                                        </span>
                                        <Copy className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1.5">
                                        {t("deposit_modal.memo_label", { ttl: expiresLabel })}
                                    </div>
                                    <div
                                        data-testid="memo-box"
                                        onClick={() => copy(intent.memo, t("deposit_modal.memo_copied"))}
                                        className="flex items-center justify-between gap-2 bg-cyber-bg border border-cyber-cyan/30 rounded-xl p-3 cursor-pointer hover:border-cyber-cyan/60 transition"
                                    >
                                        <span className="font-mono text-xs text-cyber-cyan truncate">
                                            {intent.memo}
                                        </span>
                                        <Copy className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1.5">
                                        {t("deposit_modal.amount_label")}
                                    </div>
                                    <div className="relative">
                                        <input
                                            data-testid="deposit-amount-input"
                                            type="number"
                                            min="0.1"
                                            step="0.1"
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            className="w-full bg-cyber-bg border border-white/10 rounded-xl p-4 pr-16 text-white text-lg font-mono focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan outline-none transition"
                                        />
                                        <Diamond className="w-5 h-5 text-cyber-cyan absolute right-4 top-1/2 -translate-y-1/2" />
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {PRESETS.map((p) => (
                                            <button
                                                key={p}
                                                data-testid={`amount-preset-${p}`}
                                                onClick={() => setAmount(p)}
                                                className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                                                    Number(amount) === p
                                                        ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                                                }`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    data-testid="pay-with-tonconnect-btn"
                                    onClick={handlePay}
                                    disabled={sending || polling}
                                    className="w-full bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-display font-bold text-base rounded-xl px-6 py-4 shadow-neon-purple hover:shadow-neon-cyan transition-all uppercase tracking-wide disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {sending ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> {t("deposit_modal.opening_wallet")}</>
                                    ) : polling ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> {t("deposit_modal.waiting_confirm")}</>
                                    ) : (
                                        <>{t("deposit_modal.pay_btn")}</>
                                    )}
                                </button>
                                <p className="text-[10px] text-white/40 text-center -mt-1">
                                    {t("deposit_modal.memo_warn")}
                                </p>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
