import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Diamond, Sparkles, ShieldCheck, ArrowRight } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { fetchCases, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { DailyFreeCaseTile } from "@/components/DailyFreeCaseTile";

// Phase 6b-redesign — per-case glow tints (fallback used for any unknown id).
const TIER_KEYS = {
    pocket_box:     { glow: "from-emerald-400/30 to-cyan-500/15" },
    stickers_box:   { glow: "from-emerald-500/30 to-cyber-cyan/15" },
    premium_pack:   { glow: "from-emerald-500/30 to-cyber-cyan/20" },
    lucky_charm:    { glow: "from-emerald-400/35 to-yellow-500/15" },
    royal_chest:    { glow: "from-cyber-purple/40 to-cyber-magenta/25" },
    diamond_vault:  { glow: "from-cyber-cyan/40 to-cyber-purple/25" },
    imperial_trove: { glow: "from-yellow-400/35 to-amber-700/20" },
    celestial_box:  { glow: "from-cyber-purple/40 to-cyber-cyan/20" },
    mythic_crown:   { glow: "from-cyber-magenta/50 to-cyber-purple/40" },
    whale_vault:    { glow: "from-yellow-400/50 to-amber-500/30" },
    olympus_cache:  { glow: "from-yellow-300/45 to-amber-600/25" },
    legend_pack:    { glow: "from-red-500/40 to-amber-500/20" },
};

// Phase 6b — category visual hierarchy.
// All four categories appear in this order on the page.
const CATEGORY_ORDER = ["free", "low", "middle", "high"];
const CATEGORY_META = {
    free: {
        badge: "FREE",
        badgeClass: "bg-cyan-400/15 text-cyan-300 border-cyan-400/30",
        rule: "from-cyan-400/0 via-cyan-400/40 to-cyan-400/0",
        tabActive: "bg-cyan-400/15 text-cyan-200 border-cyan-400/40",
    },
    low: {
        badge: "STARTER",
        badgeClass: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
        rule: "from-emerald-400/0 via-emerald-400/40 to-emerald-400/0",
        tabActive: "bg-emerald-400/15 text-emerald-200 border-emerald-400/40",
    },
    middle: {
        badge: "PREMIUM",
        badgeClass: "bg-cyber-purple/20 text-purple-200 border-cyber-purple/40",
        rule: "from-cyber-purple/0 via-cyber-purple/50 to-cyber-purple/0",
        tabActive: "bg-cyber-purple/20 text-purple-200 border-cyber-purple/40",
    },
    high: {
        badge: "WHALE",
        badgeClass: "bg-yellow-400/15 text-yellow-300 border-yellow-400/40",
        rule: "from-yellow-400/0 via-yellow-400/50 to-yellow-400/0",
        tabActive: "bg-yellow-400/15 text-yellow-200 border-yellow-400/40",
    },
};

export const CasesListPage = ({ balance }) => {
    const { t } = useTranslation();
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("all"); // "all" | "free" | "low" | "middle" | "high"

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

    // Group cases by category. Cases without a category default to "low".
    const grouped = useMemo(() => {
        const out = { free: [], low: [], middle: [], high: [] };
        for (const c of cases) {
            const cat = CATEGORY_ORDER.includes(c.category) ? c.category : "low";
            out[cat].push(c);
        }
        return out;
    }, [cases]);

    const tabs = useMemo(
        () => [
            { key: "all", label: t("cases_list.tabs.all") },
            ...CATEGORY_ORDER.filter((k) => grouped[k].length > 0).map((k) => ({
                key: k,
                label: t(`cases_list.categories.${k}`),
            })),
        ],
        [grouped, t],
    );

    const visibleCategories = activeTab === "all" ? CATEGORY_ORDER : [activeTab];

    return (
        <main
            className="mx-auto px-4 sm:px-6 pt-6 pb-24 lg:pb-6 space-y-6
                       max-w-[430px] sm:max-w-[640px] lg:max-w-[900px]"
            data-testid="cases-list-page"
        >
            {/* Hero — kept tight to leave room for category sections */}
            <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
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

            {/* Category tabs (mobile/tablet only — desktop shows all sections inline) */}
            <nav
                className="lg:hidden -mx-1 px-1 sticky top-[52px] z-30 bg-cyber-bg/85 backdrop-blur-xl py-2 overflow-x-auto"
                data-testid="cases-category-tabs"
            >
                <div className="flex items-center gap-2 min-w-max">
                    {tabs.map((tab) => {
                        const isActive = activeTab === tab.key;
                        const meta = CATEGORY_META[tab.key];
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                data-testid={`cases-tab-${tab.key}`}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition ${
                                    isActive
                                        ? meta?.tabActive || "bg-white/10 text-white border-white/20"
                                        : "bg-white/[0.03] text-white/50 border-white/10 hover:text-white/80"
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {loading && (
                <div className="py-10 text-center text-white/40 text-sm">{t("cases_list.loading")}</div>
            )}

            {!loading && visibleCategories.map((catKey) => {
                const list = grouped[catKey];
                if (!list || list.length === 0) return null;
                const meta = CATEGORY_META[catKey];
                return (
                    <section
                        key={catKey}
                        data-testid={`category-section-${catKey}`}
                        className="space-y-3"
                    >
                        {/* Section header — divider + label + count */}
                        <div className="flex items-center gap-3">
                            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold tracking-widest border ${meta.badgeClass}`}>
                                {meta.badge}
                            </span>
                            <h2 className="text-sm font-display font-bold tracking-wide text-white/85 uppercase">
                                {t(`cases_list.categories.${catKey}`)}
                            </h2>
                            <span className="text-[10px] text-white/30 tabular-nums">{list.length}</span>
                            <div className={`flex-1 h-px bg-gradient-to-r ${meta.rule}`} />
                        </div>

                        {/* Free category gets the DailyFreeCaseTile only (it has its own hero) */}
                        {catKey === "free" ? (
                            <DailyFreeCaseTile />
                        ) : (
                            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2">
                                {list.map((c, i) => (
                                    <CaseRow
                                        key={c.id}
                                        c={c}
                                        i={i}
                                        balance={balance}
                                        meta={meta}
                                        t={t}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                );
            })}

            <div className="pt-2 grid grid-cols-3 gap-2">
                <Trust icon={ShieldCheck} label={t("cases_list.trust_provably_fair")} />
                <Trust icon={Sparkles} label={t("cases_list.trust_instant_roll")} />
                <Trust icon={Diamond} label={t("cases_list.trust_mainnet")} />
            </div>
        </main>
    );
};

const CaseRow = ({ c, i, balance, meta, t }) => {
    const tier = TIER_KEYS[c.id] || { glow: "from-cyber-purple/30 to-cyber-cyan/20" };
    const tierLabel = t(`case_tiers.${c.id}`, { defaultValue: c.name });
    const affordable = balance >= c.price_ton;
    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
            <Link
                to={`/case/${c.id}`}
                data-testid={`case-card-${c.id}`}
                className="block relative overflow-hidden rounded-2xl border border-white/10 bg-cyber-surface group transition-all hover:border-cyber-cyan/40"
            >
                <div className={`absolute inset-0 bg-gradient-to-br ${tier.glow} opacity-40 group-hover:opacity-60 transition`} />
                {/* Category mini-badge top-right */}
                <span
                    className={`absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-md text-[8px] font-extrabold tracking-widest border ${meta.badgeClass}`}
                    data-testid={`case-badge-${c.id}`}
                >
                    {meta.badge}
                </span>
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
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
};

const Trust = ({ icon: Icon, label }) => (
    <div className="flex flex-col items-center gap-1 bg-white/[0.03] border border-white/10 rounded-lg py-2 px-1">
        <Icon className="w-3.5 h-3.5 text-cyber-cyan" strokeWidth={2} />
        <span className="text-[9px] uppercase tracking-wider text-white/50 font-bold text-center leading-tight">
            {label}
        </span>
    </div>
);
