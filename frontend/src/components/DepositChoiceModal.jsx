/**
 * Phase 11.2.6 — DepositChoiceModal
 *
 * Bottom-sheet modal that consolidates two deposit entry points into a single
 * surface, opened from the header balance widget:
 *
 *   1. "Connect wallet" — opens the TonConnect modal so the user can attach
 *      a TON wallet for instant deposits & withdrawals via TonConnect.
 *      If a wallet is already connected, this option becomes "Disconnect
 *      wallet" and shows the connected short address as a status line.
 *
 *   2. "On-chain transfer" — closes this sheet and opens the existing
 *      DepositModal (vault address + memo flow), unchanged from earlier
 *      phases.
 *
 * This replaces the previous header layout that showed both a balance pill
 * AND a separate yellow `<TonConnectButton />` next to it, which two users
 * misinterpreted as two competing CTAs.
 */
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { Wallet, ArrowDownToLine, LogOut, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tapMedium } from "@/lib/haptics";
import { sfx } from "@/lib/sound";


export const DepositChoiceModal = ({ open, onClose, onChooseDeposit }) => {
    const { t } = useTranslation();
    const [tonConnectUI] = useTonConnectUI();
    const tonAddress = useTonAddress();
    const isConnected = !!tonAddress;
    const shortAddr = tonAddress
        ? `${tonAddress.slice(0, 4)}…${tonAddress.slice(-4)}`
        : null;

    const handleWalletAction = async () => {
        tapMedium();
        try { sfx.play("modal_whoosh", { volume: 0.45 }); } catch { /* iOS */ }
        try {
            if (isConnected) {
                await tonConnectUI.disconnect();
            } else {
                await tonConnectUI.openModal();
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error("[DepositChoice] wallet action failed:", e);
        }
        onClose?.();
    };

    const handleOnChain = () => {
        tapMedium();
        onClose?.();
        onChooseDeposit?.();
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    data-testid="deposit-choice-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center px-3 pb-3 sm:pb-0"
                    style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
                    onClick={onClose}
                >
                    <motion.div
                        data-testid="deposit-choice-modal"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 28, stiffness: 280 }}
                        className="w-full max-w-md bg-[#0F0F13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        style={{ isolation: "isolate" }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 pt-5 pb-3">
                            <h2
                                data-testid="deposit-choice-title"
                                className="font-display text-lg font-bold tracking-wide"
                            >
                                {t("header.deposit_modal_title")}
                            </h2>
                            <button
                                data-testid="deposit-choice-close"
                                onClick={onClose}
                                aria-label={t("common.close")}
                                className="p-1.5 rounded-lg text-white/55 hover:text-white hover:bg-white/5 transition"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Choices */}
                        <div className="px-4 pb-5 space-y-2.5">
                            {/* Wallet (Connect / Disconnect) */}
                            <button
                                data-testid={isConnected ? "deposit-choice-disconnect" : "deposit-choice-connect"}
                                onClick={handleWalletAction}
                                className="w-full text-left rounded-xl border border-cyber-cyan/30 bg-gradient-to-br from-cyber-cyan/10 via-cyber-cyan/5 to-transparent hover:from-cyber-cyan/20 hover:border-cyber-cyan/55 active:scale-[0.99] transition px-4 py-3.5 flex items-start gap-3"
                            >
                                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-cyber-cyan/15 border border-cyber-cyan/30 flex items-center justify-center">
                                    {isConnected ? (
                                        <LogOut className="w-5 h-5 text-cyber-cyan" />
                                    ) : (
                                        <Wallet className="w-5 h-5 text-cyber-cyan" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-display font-bold text-sm leading-tight">
                                        {isConnected
                                            ? t("header.disconnect_wallet")
                                            : t("header.connect_wallet")}
                                    </div>
                                    <div className="text-[11px] text-white/55 leading-snug mt-0.5">
                                        {isConnected
                                            ? t("header.connected_as", { addr: shortAddr })
                                            : t("header.connect_wallet_desc")}
                                    </div>
                                </div>
                            </button>

                            {/* On-chain TON transfer */}
                            <button
                                data-testid="deposit-choice-onchain"
                                onClick={handleOnChain}
                                className="w-full text-left rounded-xl border border-cyber-purple/30 bg-gradient-to-br from-cyber-purple/10 via-cyber-purple/5 to-transparent hover:from-cyber-purple/20 hover:border-cyber-purple/55 active:scale-[0.99] transition px-4 py-3.5 flex items-start gap-3"
                            >
                                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-cyber-purple/15 border border-cyber-purple/30 flex items-center justify-center">
                                    <ArrowDownToLine className="w-5 h-5 text-cyber-purple" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-display font-bold text-sm leading-tight">
                                        {t("header.deposit_onchain")}
                                    </div>
                                    <div className="text-[11px] text-white/55 leading-snug mt-0.5">
                                        {t("header.deposit_onchain_desc")}
                                    </div>
                                </div>
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DepositChoiceModal;
