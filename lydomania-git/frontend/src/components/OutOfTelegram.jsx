import React from "react";
import { motion } from "framer-motion";
import { MessageCircle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const BOT_USER = "lydomania777_bot";

export const OutOfTelegram = ({ onDevBypass }) => {
    const { t } = useTranslation();
    return (
        <div
            data-testid="out-of-telegram-screen"
            className="min-h-screen flex flex-col items-center justify-center p-6 text-center cyber-grid-bg"
        >
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="max-w-sm"
            >
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyber-cyan/20 to-cyber-purple/20 border border-cyber-cyan/30 flex items-center justify-center animate-pulse-glow">
                    <MessageCircle className="w-12 h-12 text-cyber-cyan" strokeWidth={1.8} />
                </div>
                <h1 className="font-display text-3xl font-black mb-2 tracking-tighter">
                    <span className="bg-gradient-to-r from-cyber-cyan to-cyber-purple bg-clip-text text-transparent">
                        {t("out_of_telegram.title")}
                    </span>
                </h1>
                <p className="text-white/60 mb-8 leading-relaxed">
                    {t("out_of_telegram.subtitle")}
                </p>

                <a
                    href={`https://t.me/${BOT_USER}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="open-telegram-btn"
                    className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-display font-bold text-base rounded-xl px-6 py-4 shadow-neon-purple hover:shadow-neon-cyan transition-all uppercase tracking-wide"
                >
                    {t("out_of_telegram.open_in_telegram")} <ArrowRight className="w-4 h-4" />
                </a>

                {onDevBypass && (
                    <button
                        data-testid="dev-bypass-btn"
                        onClick={onDevBypass}
                        className="mt-3 text-xs text-white/40 hover:text-cyber-cyan transition underline underline-offset-4"
                    >
                        {t("out_of_telegram.dev_bypass")}
                    </button>
                )}

                <div className="mt-10 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-white/30">
                    <div>{t("out_of_telegram.badge_provably_fair")}</div>
                    <div className="text-white/50">{t("out_of_telegram.badge_mainnet")}</div>
                    <div>{t("out_of_telegram.badge_nft_gifts")}</div>
                </div>
            </motion.div>
        </div>
    );
};
