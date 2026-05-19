/**
 * Phase 11.1 — Single source of truth for any item / gift visual.
 *
 * Used by /inventory, /case/:id odds rail, case-open reveal, /market,
 * /roulette dispensary, Top Wins 24h, BattlePass tier rewards,
 * Achievement reward previews.
 *
 *   <GiftCard
 *      item={{id, item_name, item_slug, image_url|image_path, rarity, payout_ton}}
 *      size="sm"|"md"|"lg"
 *      state="idle"|"listed"|"locked"|"won"|"mock"
 *      priceChip="…" multiplierBadge={5}
 *      actionSlot={<button>…</button>}
 *      rarityOverride="legendary"
 *      onClick={() => …}
 *   />
 */
import React from "react";
import { motion } from "framer-motion";
import { Lock, Crown, Sparkles, Tag, AlertTriangle } from "lucide-react";

import { resolveImage } from "@/lib/api";
import { ImageWithFallback } from "@/components/common/ImageWithFallback";
import { formatTON } from "@/lib/rarity";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const SIZE = {
    // Phase 11.2 Final Polish — image-area tunings:
    //   sm  → 65% (roulette tiles, top wins chips)
    //   md  → 70% (default — inventory, market, BattlePass tier rewards)
    //   lg  → 80% (case-open reveal, jackpot moment)
    sm: { card: "w-24",  h: "h-24",  pad: "p-1.5",  name: "text-[10px]", price: "text-[11px]", img: "max-w-[65%] max-h-[65%]" },
    md: { card: "w-40",  h: "h-40",  pad: "p-2.5",  name: "text-xs",     price: "text-sm",     img: "max-w-[70%] max-h-[70%]" },
    lg: { card: "w-56",  h: "h-56",  pad: "p-3.5",  name: "text-sm",     price: "text-base",   img: "max-w-[80%] max-h-[80%]" },
};

const RARITY = {
    common:    { border: "border-zinc-700/60",  pill: "bg-zinc-700/60 text-zinc-200",                    glowBg: "bg-[radial-gradient(circle_at_50%_30%,rgba(212,175,55,0.04),transparent_60%)]",   label: "Common"    },
    rare:      { border: "border-blue-500/40",  pill: "bg-blue-500/20 text-blue-200 border-blue-500/40", glowBg: "bg-[radial-gradient(circle_at_50%_30%,rgba(212,175,55,0.04),transparent_60%)]",   label: "Rare"      },
    epic:      { border: "border-purple-500/45",pill: "bg-purple-500/20 text-purple-200 border-purple-500/40", glowBg: "bg-[radial-gradient(circle_at_50%_30%,rgba(212,175,55,0.10),transparent_60%)]", label: "Epic"     },
    legendary: { border: "border-gold-500/60 shadow-[0_0_24px_rgba(212,175,55,0.18)]", pill: "bg-gold-bright/20 text-gold-bright border-gold-bright/45",                   glowBg: "bg-[radial-gradient(circle_at_50%_30%,rgba(212,175,55,0.18),transparent_60%)]", label: "Legendary" },
};

const STATE_BADGES = {
    listed: { Icon: Tag,           cls: "bg-gold-bright text-zinc-950 shadow-[0_0_14px_rgba(255,215,0,0.45)]", label: "Listed" },
    locked: { Icon: Lock,           cls: "bg-zinc-700 text-zinc-200",                                            label: "Locked" },
    won:    { Icon: Sparkles,      cls: "bg-gold-bright text-zinc-950 animate-pulse",                            label: "Won"    },
    mock:   { Icon: AlertTriangle, cls: "bg-zinc-700/70 text-zinc-300",                                          label: "Mock"   },
};


export const GiftCard = ({
    item,
    size = "md",
    state = "idle",
    priceChip,
    multiplierBadge,
    actionSlot,
    rarityOverride,
    onClick,
    className = "",
    testid,
    showLabel = true,  // Phase 11.2 — set false for roulette basket / Top Wins to hide item name
    ...rest
}) => {
    const s = SIZE[size] || SIZE.md;
    const rarity = (rarityOverride || item?.rarity || "common").toLowerCase();
    const r = RARITY[rarity] || RARITY.common;
    const reduce = PRM();
    const img = resolveImage(item?.image_url || item?.image_path);
    const stateBadge = STATE_BADGES[state];
    const ItemCrown = rarity === "legendary" ? Crown : null;

    const onSale = state === "listed";

    return (
        <motion.div
            data-testid={testid || (item?.id ? `gift-card-${item.id}` : "gift-card")}
            data-card="gift"
            whileHover={reduce ? undefined : { y: -3, transition: { duration: 0.18 } }}
            whileTap={reduce ? undefined : { scale: 0.985 }}
            onClick={onClick}
            className={
                `relative ${s.card} flex flex-col rounded-2xl bg-surface-1 border ${r.border} ` +
                `overflow-hidden transition-all duration-200 ` +
                (onClick ? "cursor-pointer hover:shadow-gold-glow " : "") +
                className
            }
            {...rest}
        >
            {/* Rarity radial glow background */}
            {r.glowBg && <div aria-hidden className={`absolute inset-0 pointer-events-none ${r.glowBg}`} />}

            {/* Top-left state badge */}
            {stateBadge && (
                <div
                    data-testid={testid ? `${testid}-state-${state}` : `giftcard-state-${state}`}
                    className={`absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${stateBadge.cls}`}
                >
                    <stateBadge.Icon className="w-2.5 h-2.5" strokeWidth={2.8} />
                    {stateBadge.label}
                </div>
            )}
            {/* "ON SALE" gold ribbon overlay for listed cards (Phase 11.1) */}
            {onSale && (
                <div
                    aria-hidden
                    className="absolute -right-8 top-3 z-10 rotate-45 select-none
                               bg-gradient-to-r from-gold-bright to-gold-500
                               text-[9px] font-black uppercase tracking-widest text-zinc-950
                               px-8 py-0.5 shadow-[0_0_12px_rgba(255,215,0,0.55)]"
                >
                    On Sale
                </div>
            )}

            {/* Top-right rarity pill */}
            <div className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] backdrop-blur-sm border-transparent">
                <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 border ${r.pill}`}>
                    {ItemCrown && <ItemCrown className="w-2.5 h-2.5" strokeWidth={2.8} />}
                    {r.label}
                </span>
            </div>

            {/* Multiplier badge bottom-right of image */}
            {multiplierBadge !== undefined && multiplierBadge > 0 && (
                <div
                    className={
                        "absolute bottom-[44%] right-1.5 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums " +
                        (Number(multiplierBadge) >= 5
                            ? "bg-gold-bright text-zinc-950 shadow-[0_0_12px_rgba(255,215,0,0.5)]"
                            : "bg-gold-500/15 text-gold-300 border border-gold-500/40")
                    }
                >
                    {multiplierBadge}×
                </div>
            )}

            {/* Image area — 1:1 aspect, object-contain, gold-luxe backdrop with rarity radial.
                Phase 11.2 Final Polish: grid place-items-center for math-perfect centering;
                size-token-driven max-w/max-h; subtle transform-origin for hover/zoom hooks. */}
            <div
                className={`relative ${s.h} grid place-items-center bg-gradient-to-br from-[var(--surface-2)] via-[var(--surface-1)] to-[var(--surface-2)] overflow-hidden`}
                style={{ transformOrigin: "center" }}
            >
                <ImageWithFallback
                    src={img}
                    alt={item?.item_name || "Gift"}
                    objectFit="contain"
                    className={`${s.img} drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)] transition-transform duration-200`}
                />
            </div>

            {/* Bottom strip */}
            <div className={`relative ${s.pad} flex flex-col gap-1 flex-1`}>
                {showLabel ? (
                    <div className={`${s.name} font-semibold text-white truncate`}>
                        {item?.item_name || item?.item_slug || "Gift"}
                    </div>
                ) : (
                    // Phase 11.2 — hidden label kept in DOM for a11y / screen readers
                    <span className="sr-only">{item?.item_name || item?.item_slug || "Gift"}</span>
                )}
                <div className="flex items-center justify-between gap-1">
                    {priceChip ? (
                        <div className="font-luxe text-gold-bright font-bold tabular-nums truncate">
                            {priceChip}
                        </div>
                    ) : item?.payout_ton ? (
                        <div className={`${s.price} font-luxe text-gold-bright font-bold tabular-nums truncate inline-flex items-baseline gap-0.5`}>
                            {formatTON(item.payout_ton)}
                            <span className="text-[8px] text-gold-300/70 font-bold uppercase">TON</span>
                        </div>
                    ) : <span />}
                </div>
                {actionSlot ? <div className="mt-1">{actionSlot}</div> : null}
            </div>
        </motion.div>
    );
};

export default GiftCard;
