import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Diamond, Sparkles, ShieldCheck, ArrowRight } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { fetchCases, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { DailyFreeCaseTile } from "@/components/DailyFreeCaseTile";

const TIER_KEYS = {
    stickers_box: { glow: "from-cyber-cyan/30 to-cyber-purple/20" },
    premium_pack: { glow: "from-cyber-purple/30 to-cyber-cyan/20" },
    royal_chest: { glow: "from-cyber-purple/40 to-cyber-magenta/30" },
    diamond_vault: { glow: "from-cyber-cyan/40 to-cyber-magenta/30" },
    mythic_crown: { glow: "from-cyber-magenta/50 to-cyber-purple/40" },
};

export const CasesListPage = ({ balance }) => {
    const { t } = useTranslation();
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const c = await fetchCases();
                setCases(c);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <main className="mx-auto px-4 sm:px-6 pt-6 pb-24 lg:pb-6 space-y-6
            max-w-[430px] sm:max-w-[640px] lg:max-w-[860px]" data-testid="cases-list-page">
            <DailyFreeCaseTile />
            {/* Hero */}
            <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45 }}
                className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyber-purple/15 via-cyber-bg to-cyber-bg p-5"
            >
                <div className="absolute -top-20 -right-20 w-60 h-60 bg-cyber-cyan/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-cyber-magenta/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative">
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyber-cyan">
                        {t("cases_list.phase_chip")}
                    </span>
                    <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tighter mt-1 mb-2">
                        <span className="bg-gradient-to-r from-cyber-cyan to-cyber-purple bg-clip-text text-transparent">
                            {t("cases_list.tagline_top")}
                        </span>
                        <br />{t("cases_list.tagline_bot")}
                    </h1>
                    <p className="text-xs text-white/55 leading-relaxed">
                        <Trans
                            i18nKey="cases_list.intro"
                            components={{ strong: <span className="text-cyber-cyan font-bold" /> }}
                        />
                    </p>
                </div>
            </motion.section>

            {/* Cases column */}
            <section data-testid="cases-list">
                {loading ? (
                    <div className="py-10 text-center text-white/40 text-sm">{t("cases_list.loading")}</div>
                ) : (
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2">
                        {cases.map((c, i) => {
                            const tier = TIER_KEYS[c.id] || { glow: "from-cyber-purple/30 to-cyber-cyan/20" };
                            const tierLabel = t(`case_tiers.${c.id}`, {
                                defaultValue: c.name,
                            });
                            const affordable = balance >= c.price_ton;
                            return (
                                <motion.div
                                    key={c.id}
                                    initial={{ opacity: 0, y: 18 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                                >
                                    <Link
                                        to={`/case/${c.id}`}
                                        data-testid={`case-card-${c.id}`}
                                        className={`block relative overflow-hidden rounded-2xl border border-white/10 bg-cyber-surface group transition-all hover:border-cyber-cyan/40`}
                                    >
                                        <div className={`absolute inset-0 bg-gradient-to-br ${tier.glow} opacity-40 group-hover:opacity-60 transition`} />
                                        <div className="relative flex items-center gap-4 p-4">
                                            <img
                                                src={resolveImage(c.image_url)}
                                                alt={c.name}
                                                className="w-24 h-24 object-cover rounded-xl flex-shrink-0 group-hover:scale-105 transition"
                                                draggable={false}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">
                                                    {tierLabel}
                                                </div>
                                                <h3 className="font-display text-lg font-bold text-white truncate">
                                                    {c.name}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <div className="inline-flex items-center gap-1 bg-white/8 border border-white/10 rounded-md px-2 py-0.5">
                                                        <Diamond className="w-3 h-3 text-cyber-cyan" strokeWidth={2.5} />
                                                        <span className="font-display font-bold text-sm tabular-nums">
                                                            {formatTON(c.price_ton, 0)}
                                                        </span>
                                                        <span className="text-[9px] text-white/60 font-bold">TON</span>
                                                    </div>
                                                    <span className="text-[9px] uppercase font-bold tracking-wider text-white/40">
                                                        {t("cases_list.items_and_rtp", {
                                                            count: c.item_count,
                                                            rtp: c.actual_ev_pct.toFixed(0),
                                                        })}
                                                    </span>
                                                </div>
                                                {!affordable && (
                                                    <div className="text-[9px] text-cyber-magenta font-bold mt-1">
                                                        {t("cases_list.need_more_ton", {
                                                            amount: formatTON(c.price_ton - balance),
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            <ArrowRight className="w-5 h-5 text-cyber-cyan flex-shrink-0 group-hover:translate-x-1 transition" />
                                        </div>
                                    </Link>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </section>

            <div className="pt-2 grid grid-cols-3 gap-2">
                <Trust icon={ShieldCheck} label={t("cases_list.trust_provably_fair")} />
                <Trust icon={Sparkles} label={t("cases_list.trust_instant_roll")} />
                <Trust icon={Diamond} label={t("cases_list.trust_mainnet")} />
            </div>
        </main>
    );
};

const Trust = ({ icon: Icon, label }) => (
    <div className="flex flex-col items-center gap-1 bg-white/[0.03] border border-white/10 rounded-lg py-2 px-1">
        <Icon className="w-3.5 h-3.5 text-cyber-cyan" strokeWidth={2} />
        <span className="text-[9px] uppercase tracking-wider text-white/50 font-bold text-center leading-tight">
            {label}
        </span>
    </div>
);
