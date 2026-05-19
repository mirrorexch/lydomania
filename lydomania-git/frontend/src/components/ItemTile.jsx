import React from "react";
import { Diamond } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RARITY_HEX, RARITY_GLOW, formatTON } from "@/lib/rarity";
import { resolveImage } from "@/lib/api";

export const ItemTile = ({
    item,
    size = "md",
    highlight = false,
    "data-testid": testId,
}) => {
    const { t } = useTranslation();
    const name = item.name || item.item_name || item.slug;
    const rarity = item.rarity || "common";
    const url = item.image_url || (item.image_path ? `/static/${item.image_path}` : "");
    const payout = Number(item.payout_ton || 0);

    const isJackpot = rarity === "jackpot";

    // Phase 6g — info row sizes only; image is FLUSH (aspect-square, w-full,
    // object-cover) and bordered by the card itself — no inner inset frame.
    const dims = {
        sm: { title: "text-[10px]", price: "text-[10px]", pad: "p-1.5" },
        md: { title: "text-[11px]", price: "text-[11px]", pad: "p-2" },
        lg: { title: "text-sm",     price: "text-sm",     pad: "p-2.5" },
    }[size];

    const ringColor = RARITY_HEX[rarity] || RARITY_HEX.common;
    const glow = RARITY_GLOW[rarity] || RARITY_GLOW.common;

    return (
        <div
            data-testid={testId}
            className="relative rounded-xl bg-cyber-surface overflow-hidden flex flex-col transition-all"
            style={{
                boxShadow: highlight ? glow : "none",
                border: isJackpot ? "2px solid transparent" : `1px solid ${ringColor}40`,
                ...(isJackpot
                    ? {
                          background:
                              "linear-gradient(#0F0F13,#0F0F13) padding-box, " +
                              "linear-gradient(135deg,#FFD700,#8A2BE2,#FF003C,#FFB800,#FF00E5) border-box",
                      }
                    : {}),
            }}
        >
            <div className="relative aspect-square bg-cyber-bg">
                <img
                    src={resolveImage(url)}
                    alt={name}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: `drop-shadow(0 0 14px ${ringColor}55)` }}
                    draggable={false}
                    loading="lazy"
                />
                <span
                    className={`absolute top-1.5 left-1.5 text-[8px] font-black uppercase tracking-[0.15em] px-1.5 py-0.5 rounded backdrop-blur-sm`}
                    style={{
                        color: ringColor,
                        background: `${ringColor}33`,
                        border: `1px solid ${ringColor}66`,
                    }}
                >
                    {t(`rarity.${rarity}`, { defaultValue: rarity })}
                </span>
            </div>
            <div className={`${dims.pad} flex flex-col`}>
                <div className={`${dims.title} font-bold text-white truncate`} title={name}>
                    {name}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                    <span className="inline-flex items-center gap-0.5">
                        <Diamond className="w-3 h-3 text-cyber-cyan" strokeWidth={2.5} />
                        <span className={`${dims.price} font-bold tabular-nums text-white`}>
                            {formatTON(payout)}
                        </span>
                    </span>
                    {typeof item.probability === "number" && (
                        <span className="text-[9px] text-white/40 tabular-nums">
                            {(item.probability * 100).toFixed(item.probability < 0.001 ? 3 : 2)}%
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};
