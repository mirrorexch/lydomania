import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Diamond, X, Wallet, ArrowRight } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { resolveImage } from "@/lib/api";
import { RARITY_HEX, formatTON } from "@/lib/rarity";

export const BatchWinSummary = ({
    open,
    batch,
    casePrice,
    onSellAll,
    onKeepAll,
    onClose,
    busy = false,
}) => {
    const { t } = useTranslation();
    useEffect(() => {
        if (!open || !batch) return;
        if (batch.net_pnl_ton > 0) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.45 },
                colors: ["#00F0FF", "#8A2BE2", "#FFB800"],
            });
        }
    }, [open, batch]);

    if (!open || !batch) return null;
    const positive = batch.net_pnl_ton > 0;
    const sortedRolls = [...batch.rolls].sort(
        (a, b) => b.payout_ton - a.payout_ton
    );

    return (
        <AnimatePresence>
            {open && batch && (
                <motion.div
                    data-testid="batch-summary-overlay"
                    className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md px-4 pb-6 sm:pb-0"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        data-testid="batch-summary"
                        className="relative w-full max-w-sm sm:max-w-md bg-cyber-surface rounded-3xl p-5 border border-white/10"
                        initial={{ y: 30, scale: 0.95, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        exit={{ y: 30, scale: 0.95, opacity: 0 }}
                        transition={{ type: "spring", damping: 22, stiffness: 260 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            boxShadow: positive
                                ? "0 0 60px rgba(0, 255, 102, 0.25)"
                                : "0 0 50px rgba(255, 0, 60, 0.20)",
                        }}
                    >
                        <button
                            data-testid="batch-summary-close"
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
                        >
                            <X className="w-4 h-4 text-white/70" />
                        </button>

                        <div className="text-center mb-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyber-cyan">
                                {t("batch_summary.header", { n: batch.rolls.length })}
                            </span>
                            <h2 className="font-display text-2xl font-black tracking-tight mt-1">
                                {positive ? "+" : ""}
                                <span className={positive ? "text-cyber-success" : "text-cyber-magenta"}>
                                    {formatTON(batch.net_pnl_ton)} TON
                                </span>
                            </h2>
                            <div className="text-[11px] text-white/50 mt-1">
                                <Trans
                                    i18nKey="batch_summary.paid"
                                    values={{
                                        paid: formatTON(batch.total_paid_ton),
                                        won: formatTON(batch.total_won_ton),
                                    }}
                                    components={{ strong: <b className="text-white/70" /> }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-5 gap-1.5 mb-4 max-h-[280px] overflow-y-auto pr-1">
                            {sortedRolls.map((r, i) => {
                                const c = RARITY_HEX[r.winning_item.rarity] || RARITY_HEX.common;
                                const m = casePrice ? r.payout_ton / casePrice : 0;
                                return (
                                    <motion.div
                                        key={r.roll_id}
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ delay: i * 0.04, type: "spring", damping: 14, stiffness: 220 }}
                                        className="aspect-square bg-cyber-bg rounded-lg flex flex-col items-center justify-center p-1 relative overflow-hidden"
                                        style={{ border: `1px solid ${c}55`, boxShadow: `inset 0 0 8px ${c}22` }}
                                        title={`${r.winning_item.name} · ${r.payout_ton.toFixed(2)} TON · ×${m.toFixed(2)}`}
                                    >
                                        <img
                                            src={resolveImage(r.winning_item.image_url)}
                                            alt={r.winning_item.name}
                                            className="w-3/4 h-3/4 object-contain"
                                            style={{ filter: `drop-shadow(0 0 6px ${c}77)` }}
                                            draggable={false}
                                        />
                                        <div className="text-[8px] font-mono font-bold text-white/80 tabular-nums">
                                            {r.payout_ton.toFixed(1)}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>

                        <div className="flex gap-2">
                            <button
                                data-testid="batch-sell-all-btn"
                                onClick={onSellAll}
                                disabled={busy}
                                className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-display font-black text-sm rounded-xl px-4 py-3 uppercase tracking-wide disabled:opacity-50"
                            >
                                <Wallet className="w-4 h-4" /> {t("batch_summary.sell_all", { amount: formatTON(batch.total_won_ton) })}
                            </button>
                            <button
                                data-testid="batch-keep-all-btn"
                                onClick={onKeepAll}
                                disabled={busy}
                                className="flex-1 inline-flex items-center justify-center gap-2 bg-white/5 border border-white/15 hover:bg-white/10 transition text-white font-display font-bold text-sm rounded-xl px-4 py-3 uppercase tracking-wide disabled:opacity-50"
                            >
                                {t("batch_summary.keep_all")} <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>

                        <p className="mt-3 text-[10px] text-white/40 text-center font-mono">
                            {t("batch_summary.nonce_footer", {
                                from: batch.rolls[0]?.nonce,
                                to: batch.rolls.at(-1)?.nonce,
                            })}
                        </p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
