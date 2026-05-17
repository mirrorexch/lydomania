import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTonAddress } from "@tonconnect/ui-react";
import { Diamond, X, Wallet, Send, Loader2, AlertCircle, Activity } from "lucide-react";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";
import { withdrawInventoryItem, resolveImage, fetchFloorPrices } from "@/lib/api";
import { RARITY_HEX, formatTON } from "@/lib/rarity";

const TON_ADDR_RE = /^[UE]Q[A-Za-z0-9_\-]{46}$/;

export const WithdrawModal = ({ item, open, onClose, onConfirmed }) => {
    const { t } = useTranslation();
    const tonAddress = useTonAddress();
    const [address, setAddress] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [floor, setFloor] = useState(null);

    useEffect(() => {
        if (open) setAddress(tonAddress || "");
    }, [open, tonAddress]);

    useEffect(() => {
        if (!open || !item?.item_slug) { setFloor(null); return; }
        let cancelled = false;
        fetchFloorPrices(item.item_slug)
            .then((d) => { if (!cancelled) setFloor(d || null); })
            .catch(() => { if (!cancelled) setFloor(null); });
        return () => { cancelled = true; };
    }, [open, item?.item_slug]);

    if (!item) return null;
    const color = RARITY_HEX[item.rarity] || RARITY_HEX.common;
    const valid = TON_ADDR_RE.test((address || "").trim());

    const handleConfirm = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            await withdrawInventoryItem(item.id, address.trim());
            toast.success(t("withdraw_modal.queued_title"), {
                description: t("withdraw_modal.queued_subtitle", {
                    item: item.item_name,
                    addr: `${address.slice(0, 6)}…${address.slice(-6)}`,
                }),
            });
            onConfirmed?.();
            onClose?.();
        } catch (e) {
            toast.error(t("withdraw_modal.submit_failed"), {
                description: e?.response?.data?.detail || e?.message,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                    data-testid="withdraw-modal-backdrop"
                    className="fixed inset-0 z-[60] bg-cyber-bg/85 backdrop-blur-md flex items-end sm:items-center justify-center p-3"
                >
                    <motion.div
                        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
                        transition={{ type: "spring", damping: 24 }}
                        onClick={(e) => e.stopPropagation()}
                        data-testid="withdraw-modal"
                        className="w-full max-w-[430px] rounded-2xl bg-cyber-surface border border-white/10 shadow-2xl overflow-hidden"
                        style={{ boxShadow: `0 0 60px ${color}22` }}
                    >
                        <div className="flex items-center justify-between px-4 pt-4">
                            <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50 inline-flex items-center gap-1.5">
                                <Send className="w-3 h-3 text-cyber-cyan" /> {t("withdraw_modal.title")}
                            </div>
                            <button onClick={onClose} data-testid="withdraw-modal-close" className="text-white/40 hover:text-white p-1">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="px-4 mt-3 flex items-center gap-3">
                            <div
                                className="w-16 h-16 rounded-xl flex items-center justify-center bg-cyber-bg"
                                style={{ boxShadow: `inset 0 0 14px ${color}33`, border: `1px solid ${color}44` }}
                            >
                                <img
                                    src={resolveImage(item.image_url)}
                                    alt={item.item_name}
                                    className="w-12 h-12 object-contain"
                                    style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color }}>
                                    {t(`rarity.${item.rarity}`)}
                                </div>
                                <div className="font-bold text-base truncate" title={item.item_name}>
                                    {item.item_name}
                                </div>
                                <div className="inline-flex items-center gap-1 text-sm font-mono font-bold mt-0.5">
                                    <Diamond className="w-3.5 h-3.5 text-cyber-cyan" />
                                    {formatTON(item.payout_ton)}
                                    <span className="text-[9px] text-white/40 ml-0.5">TON</span>
                                </div>
                            </div>
                        </div>

                        <div className="px-4 mt-5">
                            <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50 inline-flex items-center gap-1.5">
                                <Wallet className="w-3 h-3" /> {t("withdraw_modal.destination_label")}
                            </label>
                            <input
                                data-testid="withdraw-address-input"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="UQ... or EQ..."
                                className={`mt-1.5 w-full bg-cyber-bg/80 border rounded-xl px-3 py-2.5 text-sm font-mono outline-none transition ${
                                    !address
                                        ? "border-white/10 focus:border-white/30"
                                        : valid
                                        ? "border-cyber-cyan/40 focus:border-cyber-cyan/80"
                                        : "border-red-500/50 focus:border-red-500"
                                }`}
                            />
                            {tonAddress && tonAddress !== address && (
                                <button
                                    type="button"
                                    onClick={() => setAddress(tonAddress)}
                                    data-testid="withdraw-use-connected"
                                    className="mt-1.5 text-[10px] font-bold text-cyber-cyan hover:text-cyber-purple transition"
                                >
                                    {t("withdraw_modal.use_connected", {
                                        addr: `${tonAddress.slice(0, 6)}…${tonAddress.slice(-6)}`,
                                    })}
                                </button>
                            )}
                            {address && !valid && (
                                <div className="mt-1.5 text-[10px] text-red-400 inline-flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" /> {t("withdraw_modal.address_invalid")}
                                </div>
                            )}
                        </div>

                        {floor && floor.floor_ton ? (
                            <div className="px-4 mt-3" data-testid="withdraw-floor-line">
                                <div className="flex items-center justify-between rounded-lg bg-cyber-bg/60 border border-cyber-cyan/15 px-2.5 py-1.5">
                                    <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-cyber-cyan/80">
                                        <Activity className="w-3 h-3" /> {t("withdraw_modal.live_floor")}
                                    </div>
                                    <div className="text-[10.5px] text-white/65">
                                        <span className="font-mono font-bold text-white">{floor.floor_ton.toFixed(2)}</span>
                                        <span className="text-[9px] text-white/40 ml-0.5">TON</span>
                                        <span className="text-[9px] text-white/35 ml-1.5">{t("withdraw_modal.delivery_cost_hint")}</span>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="px-4 mt-4">
                            <div className="rounded-lg bg-cyber-bg/60 border border-cyber-cyan/20 p-2.5 text-[10.5px] text-white/70 leading-snug">
                                <div className="font-bold text-cyber-cyan mb-1 inline-flex items-center gap-1">
                                    <Wallet className="w-3 h-3" /> {t("withdraw_modal.how_works_title")}
                                </div>
                                <Trans
                                    i18nKey="withdraw_modal.how_works_body"
                                    values={{ item: item.item_name }}
                                    components={{ strong: <b className="text-white" /> }}
                                />
                            </div>
                        </div>

                        <div className="px-4 py-4 flex gap-2">
                            <button
                                onClick={onClose}
                                data-testid="withdraw-cancel-btn"
                                className="flex-1 text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 transition rounded-lg py-2.5"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={!valid || submitting}
                                data-testid="withdraw-confirm-btn"
                                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg hover:brightness-110"
                            >
                                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                {t("withdraw_modal.request")}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
