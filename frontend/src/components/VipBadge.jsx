/**
 * Phase 10.2 — VIP tier badge shown in the Header next to BattlePass HUD.
 *
 * Fetches /api/vip/me once on mount + on user change, displays a compact
 * gradient pill with tier icon + tier name. PRM-friendly micro-animation.
 * Hidden gracefully if API errors / user not logged in.
 */
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Gem, Shield, ShieldHalf, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { http } from "@/lib/api";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const TIER_VISUALS = {
    0: { color: "from-amber-700 to-amber-900",   ring: "border-amber-600/40",  icon: Shield      },
    1: { color: "from-slate-400 to-slate-600",   ring: "border-slate-400/40",  icon: ShieldHalf  },
    2: { color: "from-yellow-400 to-amber-500",  ring: "border-amber-400/55",  icon: ShieldCheck },
    3: { color: "from-cyan-400 to-blue-500",     ring: "border-cyan-400/55",   icon: Gem         },
    4: { color: "from-fuchsia-400 to-violet-500", ring: "border-fuchsia-400/55", icon: Crown      },
};

export const VipBadge = ({ user }) => {
    const { t } = useTranslation();
    const [state, setState] = useState(null);

    useEffect(() => {
        if (!user) { setState(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { data } = await http.get("/vip/me");
                if (!cancelled) setState(data);
            } catch {
                // silent — non-critical
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    if (!user || !state?.tier) return null;
    const tier = state.tier;
    const v = TIER_VISUALS[tier.tier_id] || TIER_VISUALS[0];
    const Icon = v.icon;
    const reduce = PRM();

    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
        >
            <Link
                to="/vip"
                aria-label={t("vip_badge.aria", { name: tier.name })}
                title={t("vip_badge.tooltip", { name: tier.name })}
                data-testid="vip-badge"
                className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 border ${v.ring} bg-gradient-to-r ${v.color} text-zinc-950 font-black text-[10px] uppercase tracking-[0.18em] shadow hover:brightness-110 transition`}
            >
                <Icon className="w-3 h-3" strokeWidth={2.6} aria-hidden="true" />
                <span data-testid="vip-badge-name">{tier.name}</span>
            </Link>
        </motion.div>
    );
};

export default VipBadge;
