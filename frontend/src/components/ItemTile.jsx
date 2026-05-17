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

    const dims = {
        sm: { box: "p-2", img: "h-12", title: "text-[10px]", price: "text-[10px]" },
        md: { box: "p-3", img: "h-20", title: "text-xs", price: "text-xs" },
        lg: { box: "p-4", img: "h-28", title: "text-sm", price: "text-sm" },
    }[size];

    const ringColor = RARITY_HEX[rarity] || RARITY_HEX.common;
    const glow = RARITY_GLOW[rarity] || RARITY_GLOW.common;

    return (
        <div
            data-testid={testId}
            className={`relative rounded-xl bg-cyber-surface/80 overflow-hidden flex flex-col items-center justify-between ${dims.box} transition-all`}
            style={{
                boxShadow: highlight ? glow : "inset 0 0 0 1px rgba(255,255,255,0.06)",
                border: isJackpot ? "2px solid transparent" : `1px solid ${ringColor}33`,
                ...(isJackpot
                    ? {
                          background:
                              "linear-gradient(#0F0F13,#0F0F13) padding-box, " +
                              "linear-gradient(135deg,#00F0FF,#8A2BE2,#FF003C,#FFB800,#FF00E5) border-box",
                      }
                    : {}),
            }}
        >
            <span
                className={`absolute top-1.5 left-1.5 text-[8px] font-black uppercase tracking-[0.18em] px-1.5 py-0.5 rounded`}
                style={{
                    color: ringColor,
                    background: `${ringColor}1A`,
                    border: `1px solid ${ringColor}55`,
                }}
            >
                {t(`rarity.${rarity}`, { defaultValue: rarity })}
            </span>

            <img
                src={resolveImage(url)}
                alt={name}
                className={`${dims.img} w-full object-contain mt-4 drop-shadow-xl`}
                draggable={false}
            />

            <div className="flex flex-col items-center w-full mt-2">
                <div className={`${dims.title} font-semibold text-white text-center truncate w-full`}>
                    {name}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                    <Diamond className="w-3 h-3 text-cyber-cyan" strokeWidth={2.5} />
                    <span className={`${dims.price} font-bold tabular-nums text-white`}>
                        {formatTON(payout)}
                    </span>
                </div>
                {typeof item.probability === "number" && (
                    <span className="text-[9px] text-white/40 mt-0.5">
                        {(item.probability * 100).toFixed(item.probability < 0.001 ? 3 : 2)}%
                    </span>
                )}
            </div>
        </div>
    );
};
