import React from "react";
import { motion } from "framer-motion";
import { Diamond, Sparkles } from "lucide-react";

const LOW_IMG = "/img/case-low.png";
const HIGH_IMG = "/img/case-high.png";

const NAMES = {
    10: "Initiate",
    25: "Hustler",
    50: "Operator",
    100: "Whale",
    250: "Legend",
};

export const CaseCard = ({ price, index = 0 }) => {
    const high = price >= 100;
    const img = high ? HIGH_IMG : LOW_IMG;
    const accent = high ? "from-cyber-magenta to-cyber-purple" : "from-cyber-cyan to-cyber-purple";

    return (
        <motion.div
            data-testid={`case-card-${price}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
            className="group relative rounded-2xl bg-cyber-surface border border-white/10 overflow-hidden flex flex-col justify-end aspect-[4/5] hairline-border"
        >
            <img
                src={img}
                alt={`${NAMES[price]} case`}
                className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-90 group-hover:scale-110 transition-all duration-700"
                draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-cyber-bg via-cyber-bg/60 to-transparent" />
            {high && (
                <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-md bg-cyber-magenta/20 border border-cyber-magenta/40 text-[10px] font-bold uppercase tracking-wider text-cyber-magenta backdrop-blur-md">
                    <Sparkles className="w-3 h-3" /> Epic
                </div>
            )}
            <div className="relative z-10 p-4 flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">
                    Tier · {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display font-bold text-xl text-white leading-none">
                    {NAMES[price]}
                </h3>
                <div className={`inline-flex w-fit items-center gap-1.5 bg-white/10 backdrop-blur-md rounded-lg px-2.5 py-1 border border-white/10`}>
                    <Diamond className={`w-3.5 h-3.5 bg-gradient-to-r ${accent} bg-clip-text`} strokeWidth={2.5} />
                    <span className="font-display font-bold text-base text-white tabular-nums">
                        {price}
                    </span>
                    <span className="text-[10px] font-bold text-white/60">TON</span>
                </div>
            </div>

            {/* Disabled hint */}
            <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-3">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">
                    Phase 1 · soon
                </div>
            </div>
        </motion.div>
    );
};
