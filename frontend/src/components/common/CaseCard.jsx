/**
 * Phase 11.1 — Single source of truth for any case tile visual.
 *
 * Used by /cases list, Home featured cases section, any case-promo
 * surface.
 *
 *   <CaseCard
 *      case={{id, name, price_ton, image_path}}
 *      size="md"|"lg"
 *      headlined={false}
 *      onClick={...}
 *   />
 */
import React from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Diamond, ArrowRight } from "lucide-react";

import { resolveImage } from "@/lib/api";
import { ImageWithFallback } from "@/components/common/ImageWithFallback";
import { formatTON } from "@/lib/rarity";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


// Tier inferred from case.price_ton (TON).
function tierFor(priceTon = 0) {
    const p = Number(priceTon) || 0;
    if (p >= 100)  return "headlined";
    if (p >= 25)   return "expensive";
    if (p >= 10)   return "mid";
    return "cheap";
}

const TIER_VISUAL = {
    cheap:     { border: "border-gold-500/15",     glow: "",                                              chip: "bg-gold-500/10 text-gold-200 border-gold-500/30"   },
    mid:       { border: "border-gold-500/35",     glow: "shadow-[0_0_18px_-4px_rgba(212,175,55,0.30)]",  chip: "bg-gold-500/15 text-gold-200 border-gold-500/40"   },
    expensive: { border: "border-gold-500/55",     glow: "shadow-[0_0_24px_-4px_rgba(212,175,55,0.50)]",  chip: "bg-gold-500/25 text-gold-bright border-gold-500/55"},
    headlined: { border: "border-gold-bright/55",  glow: "shadow-[0_0_32px_-4px_rgba(255,215,0,0.55)]",   chip: "bg-gold-bright/25 text-gold-bright border-gold-bright/55"},
};

const SIZE = {
    md: { card: "min-h-[180px]", titleClass: "text-sm",  ctaClass: "text-xs py-2"   },
    lg: { card: "min-h-[220px]", titleClass: "text-base", ctaClass: "text-sm py-2.5" },
};


export const CaseCard = ({ case: c, size = "md", headlined: forceHeadlined, onClick, className = "", testid }) => {
    if (!c) return null;
    const headlined = !!forceHeadlined || tierFor(c.price_ton) === "headlined";
    const tier = headlined ? "headlined" : tierFor(c.price_ton);
    const v = TIER_VISUAL[tier];
    const s = SIZE[size] || SIZE.md;
    const reduce = PRM();
    const href = `/case/${c.id}`;

    const inner = (
        <motion.div
            data-testid="case-card"
            data-card="case"
            data-case-id={c.id}
            whileHover={reduce ? undefined : { y: -3, transition: { duration: 0.18 } }}
            whileTap={reduce ? undefined : { scale: 0.985 }}
            onClick={onClick}
            className={
                `relative ${s.card} flex flex-col rounded-2xl overflow-hidden ` +
                `bg-surface-1 border ${v.border} ${v.glow} ` +
                `hover:border-gold-bright/55 hover:shadow-gold-glow ` +
                `transition-all duration-200 ${className}`
            }
        >
            {headlined && (
                <div
                    aria-hidden
                    className="absolute -left-9 top-4 z-10 -rotate-45 select-none
                               bg-gradient-to-r from-gold-bright to-gold-500
                               text-[9px] font-black uppercase tracking-widest text-zinc-950
                               px-9 py-0.5 shadow-[0_0_12px_rgba(255,215,0,0.55)]"
                    data-testid={`casecard-${c.id}-headlined-ribbon`}
                >
                    Headlined
                </div>
            )}

            {/* Image area — Phase 11.2.3: solid bg surface (no semi-transparent
                gold overlays) so the page-level 28px grid pattern cannot bleed
                through.  The PNG fills the whole image-area now.
                Phase 11.2.4: belt-and-braces — replace `bg-surface-1` with
                a hardcoded `bg-[#0A0A0A]` (arbitrary value, no CSS-var
                dependency) and add `isolation:isolate` + z-10 to force a
                fresh stacking context so the parent `.cyber-grid-bg`
                background-image cannot composite through under any
                circumstance (some Telegram WebViews were observed to render
                `var(--surface-1)` as the fallback "transparent" when the
                CSS-var resolution lost the race with image painting). */}
            <div
                className="relative aspect-[4/3] bg-[#0A0A0A] flex items-center justify-center overflow-hidden z-10"
                style={{ isolation: "isolate", backgroundColor: "#0A0A0A" }}
            >
                <ImageWithFallback
                    src={resolveImage(c.image_path || c.image_url)}
                    alt={c.name || c.id}
                    objectFit="contain"
                    className="relative w-full h-full"
                />
            </div>

            {/* Body */}
            <div className="relative p-3 flex flex-col gap-2 flex-1">
                <div className={`${s.titleClass} font-bold tracking-tight text-white truncate flex items-center gap-1.5`}>
                    {headlined && <Diamond className="w-4 h-4 text-gold-bright shrink-0" />}
                    {c.name || c.id}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-baseline gap-1 rounded-md px-2 py-0.5 text-[11px] font-luxe font-bold border ${v.chip}`}>
                        <span className="tabular-nums">{formatTON(c.price_ton)}</span>
                        <span className="text-[8px] uppercase opacity-80">TON</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-gold-300/75 group-hover:translate-x-0.5 transition" />
                </div>
                <div className={
                    `mt-auto rounded-lg ${s.ctaClass} text-center font-black uppercase tracking-wider ` +
                    "bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 " +
                    "shadow-[0_0_18px_-4px_rgba(255,215,0,0.45)]"
                }>
                    Open
                </div>
            </div>
        </motion.div>
    );

    return onClick
        ? <div role="button" tabIndex={0} aria-label={`Open ${c.name}`}>{inner}</div>
        : <Link to={href} className="block group">{inner}</Link>;
};

export default CaseCard;
