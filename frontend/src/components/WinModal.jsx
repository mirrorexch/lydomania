import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Diamond, ArrowRight, Wallet, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RARITY_HEX, formatTON, rarityRank } from "@/lib/rarity";
import { resolveImage, generateShareCard, ORIGIN } from "@/lib/api";
import { toast } from "sonner";
import { sfx } from "@/lib/sound";

function burst(rarity) {
    const tier = rarityRank(rarity);
    const colors =
        rarity === "jackpot"
            ? ["#00F0FF", "#8A2BE2", "#FF003C", "#FFB800", "#FF00E5"]
            : rarity === "mythic"
            ? ["#FF003C", "#FF00E5", "#8A2BE2"]
            : rarity === "legendary"
            ? ["#FFB800", "#FF8800", "#00F0FF"]
            : rarity === "epic"
            ? ["#8A2BE2", "#00F0FF"]
            : rarity === "rare"
            ? ["#00F0FF", "#FFFFFF"]
            : ["#94a3b8", "#FFFFFF"];

    const count = 40 + tier * 30;
    const spread = 50 + tier * 12;
    confetti({
        particleCount: count,
        spread,
        origin: { y: 0.5 },
        colors,
        startVelocity: 32 + tier * 4,
        scalar: 0.9 + tier * 0.15,
    });
    if (tier >= 3) {
        setTimeout(() => {
            confetti({ particleCount: count, angle: 60, spread: 70, origin: { x: 0, y: 0.6 }, colors });
            confetti({ particleCount: count, angle: 120, spread: 70, origin: { x: 1, y: 0.6 }, colors });
        }, 250);
    }
}

export const WinModal = ({ open, roll, casePrice, onSell, onKeep, onClose, busy = false }) => {
    const { t } = useTranslation();
    const item = roll?.winning_item;
    const rarity = item?.rarity || "common";
    const accent = RARITY_HEX[rarity];
    const multiplier = roll && casePrice ? roll.payout_ton / casePrice : 0;
    const big = multiplier >= 2;

    useEffect(() => {
        if (open && item) {
            burst(rarity);
            sfx.playWin(rarity);
            if (multiplier >= 5) {
                setTimeout(() => burst(rarity), 600);
                setTimeout(() => sfx.play("coin_drop", { volume: 0.7 }), 800);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, item?.slug]);

    return (
        <AnimatePresence>
            {open && item && (
                <motion.div
                    data-testid="win-modal-overlay"
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md px-4"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        data-testid="win-modal"
                        className="relative w-full max-w-sm bg-cyber-surface rounded-3xl p-6 overflow-hidden"
                        initial={{ y: 30, scale: 0.92, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        exit={{ y: 30, scale: 0.92, opacity: 0 }}
                        transition={{ type: "spring", damping: 22, stiffness: 260 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ border: `2px solid ${accent}`, boxShadow: `0 0 60px ${accent}77` }}
                    >
                        <div className="absolute -top-24 -right-24 w-60 h-60 rounded-full opacity-30 blur-3xl" style={{ background: accent }} />
                        <div className="absolute -bottom-24 -left-24 w-60 h-60 rounded-full opacity-25 blur-3xl" style={{ background: accent }} />

                        <div className="relative text-center">
                            <span
                                className="text-[10px] font-black uppercase tracking-[0.3em] px-3 py-1 rounded-full"
                                style={{ color: accent, background: `${accent}1F`, border: `1px solid ${accent}66` }}
                            >
                                {t(`rarity.${rarity}`)}{big ? t("win_modal.big_win_suffix") : ""}
                            </span>

                            <motion.div
                                initial={{ scale: 0.5, rotate: -8 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.1, type: "spring", damping: 10, stiffness: 150 }}
                                className="mt-5 mx-auto flex items-center justify-center"
                            >
                                <img
                                    src={resolveImage(item.image_url)}
                                    alt={item.name}
                                    className="h-44 w-44 object-contain drop-shadow-2xl"
                                    style={{ filter: `drop-shadow(0 0 28px ${accent})` }}
                                    draggable={false}
                                />
                            </motion.div>

                            <h2 className="font-display text-2xl font-black tracking-tight mt-3 text-white">
                                {item.name}
                            </h2>

                            <div className="mt-2 inline-flex items-center gap-1.5 bg-cyber-bg/80 border border-white/10 rounded-xl px-3 py-1.5">
                                <Diamond className="w-4 h-4" style={{ color: accent }} strokeWidth={2.5} />
                                <span className="font-display font-black text-xl text-white tabular-nums">
                                    {formatTON(roll.payout_ton, 2)}
                                </span>
                                <span className="text-[10px] font-bold text-white/60">TON</span>
                                {casePrice ? (
                                    <span className="text-[10px] font-bold ml-1" style={{ color: multiplier >= 1 ? accent : "#94a3b8" }}>
                                        ×{multiplier.toFixed(2)}
                                    </span>
                                ) : null}
                            </div>

                            <div className="mt-2 text-[10px] text-white/40 font-mono">
                                roll {roll.roll_float.toFixed(8)} · nonce {roll.nonce}
                            </div>

                            <div className="mt-5 flex gap-2">
                                <button
                                    data-testid="win-sell-btn"
                                    onClick={() => onSell(roll.inventory_id)}
                                    disabled={busy}
                                    className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-display font-bold text-sm rounded-xl px-4 py-3 uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Wallet className="w-4 h-4" />
                                    {t("win_modal.sell", { amount: formatTON(roll.payout_ton) })}
                                </button>
                                <button
                                    data-testid="win-keep-btn"
                                    onClick={onKeep}
                                    disabled={busy}
                                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white/5 border border-white/15 hover:bg-white/10 transition text-white font-display font-bold text-sm rounded-xl px-4 py-3 uppercase tracking-wide disabled:opacity-50"
                                >
                                    {t("win_modal.keep")} <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>

                            {big && (
                                <button
                                    data-testid="win-share-btn"
                                    onClick={async () => {
                                        try {
                                            const r = await generateShareCard(roll.roll_id);
                                            const fullUrl = r.url.startsWith("http") ? r.url : `${ORIGIN}${r.url}`;
                                            const caption = t("win_modal.share_caption", {
                                                item: roll.winning_item.name,
                                                mult: (roll.payout_ton / (casePrice || 1)).toFixed(2),
                                            });
                                            const tg = window.Telegram?.WebApp;
                                            if (tg?.shareToStory) {
                                                tg.shareToStory(fullUrl, { text: caption });
                                            } else if (tg?.openTelegramLink) {
                                                tg.openTelegramLink(
                                                    `https://t.me/share/url?url=${encodeURIComponent(fullUrl)}&text=${encodeURIComponent(caption)}`
                                                );
                                            } else {
                                                window.open(fullUrl, "_blank");
                                            }
                                            toast.success(t("win_modal.share_ready"));
                                        } catch (e) {
                                            toast.error(t("win_modal.share_failed"), {
                                                description: e?.response?.data?.detail || e?.message,
                                            });
                                        }
                                    }}
                                    className="w-full mt-2 inline-flex items-center justify-center gap-2 bg-white/[0.04] border border-cyber-cyan/40 hover:border-cyber-cyan/80 text-cyber-cyan font-display font-bold text-xs rounded-xl px-4 py-2.5 uppercase tracking-wider"
                                >
                                    <Share2 className="w-3 h-3" /> {t("win_modal.share")}
                                </button>
                            )}

                            <p className="mt-3 text-[10px] text-white/40">
                                {t("win_modal.fair_footer")}
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
