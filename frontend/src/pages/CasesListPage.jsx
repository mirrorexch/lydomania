import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
    Diamond, Sparkles, ShieldCheck, ArrowRight, Crown, Swords, Disc3, Rocket,
    ChevronsDown, Bomb,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchCases, resolveImage, caseThumbUrl } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { DailyFreeCaseTile } from "@/components/DailyFreeCaseTile";
import { TopWins24h } from "@/components/TopWins24h";
import { CaseCard } from "@/components/common/CaseCard";
import { JackpotCounter } from "@/components/JackpotCounter";
import ActivityTicker from "@/components/ActivityTicker";
import { selectionChanged } from "@/lib/haptics";


// Phase 11 — All glow tints harmonized to warm gold (Stake/Roobet luxe palette).
const TIER_GLOW = {
    pocket_box:     "from-gold-700/35 to-gold-900/20",
    stickers_box:   "from-gold-700/35 to-gold-800/15",
    premium_pack:   "from-gold-600/35 to-gold-800/20",
    lucky_charm:    "from-gold-500/35 to-gold-700/20",
    royal_chest:    "from-gold-bright/35 to-gold-700/25",
    diamond_vault:  "from-gold-300/40 to-gold-600/25",
    imperial_trove: "from-gold-bright/45 to-gold-600/25",
    celestial_box:  "from-gold-300/40 to-gold-700/25",
    mythic_crown:   "from-gold-bright/50 to-gold-500/35",
    whale_vault:    "from-gold-bright/55 to-gold-500/35",
    olympus_cache:  "from-gold-300/50 to-gold-600/30",
    legend_pack:    "from-gold-bright/45 to-red-500/20",
};

// Phase 11 — Category blocks recoloured to four gold-shade variants. Background
// PNGs are kept (no regen) but the ring colour is fully harmonized.
const CATEGORY_DEFS = [
    {
        key:    "free",
        bg:     "/categories/free.png",
        ring:   "border-gold-300/70 shadow-[0_0_24px_-4px_rgba(255,235,153,0.55)]",
        accent: "text-gold-200",
    },
    {
        key:    "low",
        bg:     "/categories/low.png",
        ring:   "border-gold-400/70 shadow-[0_0_24px_-4px_rgba(232,197,71,0.55)]",
        accent: "text-gold-200",
    },
    {
        key:    "middle",
        bg:     "/categories/middle.png",
        ring:   "border-gold-500/80 shadow-[0_0_28px_-4px_rgba(212,175,55,0.65)]",
        accent: "text-gold-bright",
    },
    {
        key:    "high",
        bg:     "/categories/high.png",
        ring:   "border-gold-bright/80 shadow-[0_0_32px_-2px_rgba(255,215,0,0.65)]",
        accent: "text-gold-bright",
    },
];

const CATEGORY_BADGE = {
    free:   "bg-gold-300/15 text-gold-200 border-gold-300/30",
    low:    "bg-gold-400/15 text-gold-200 border-gold-400/35",
    middle: "bg-gold-500/20 text-gold-bright border-gold-500/45",
    high:   "bg-gold-bright/20 text-gold-bright border-gold-bright/50",
};


export const CasesListPage = ({ balance }) => {
    const { t } = useTranslation();
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    // Phase 6h — `null` = no filter = show all sections. Tap-to-toggle.
    const [active, setActive] = useState(null);

    useEffect(() => {
        (async () => {
            try { setCases(await fetchCases()); }
            finally { setLoading(false); }
        })();
    }, []);

    // Group by category (cases without one default to "low")
    const grouped = useMemo(() => {
        const out = { free: [], low: [], middle: [], high: [] };
        for (const c of cases) {
            const cat = ["free", "low", "middle", "high"].includes(c.category) ? c.category : "low";
            out[cat].push(c);
        }
        return out;
    }, [cases]);

    const counts = useMemo(() => ({
        free: grouped.free.length,
        low: grouped.low.length,
        middle: grouped.middle.length,
        high: grouped.high.length,
    }), [grouped]);

    const visible = useMemo(() => {
        if (active === null) {
            return ["free", "low", "middle", "high"]
                .map((k) => ({ cat: k, list: grouped[k] }))
                .filter((x) => x.list.length > 0);
        }
        return [{ cat: active, list: grouped[active] || [] }];
    }, [active, grouped]);

    const onCatTap = (key) => {
        selectionChanged();
        setActive((cur) => (cur === key ? null : key));   // tap same = deselect
    };

    return (
        <main
            className="mx-auto px-4 sm:px-6 pt-4 pb-28 lg:pb-6 space-y-5
                       max-w-[430px] sm:max-w-[640px] lg:max-w-[960px]"
            data-testid="cases-list-page"
        >
            {/* Phase 11 — Gold-luxe HOME HERO. Uses pre-generated nano-banana
                background asset + Cormorant-Garamond hero numerals for the
                jackpot and total-paid stat counters. */}
            <section
                data-testid="home-hero"
                className="relative overflow-hidden rounded-3xl border border-gold-500/25
                           shadow-[0_18px_60px_-22px_rgba(212,175,55,0.45)]
                           bg-surface-2"
            >
                <div
                    aria-hidden
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: "url(/banners/home_hero_gold_luxe.webp)" }}
                />
                <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-tr from-black/85 via-black/55 to-transparent"
                />
                <div className="relative px-5 sm:px-7 py-6 sm:py-8">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-gold-bright/15 border border-gold-bright/40 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] text-gold-bright">
                        <Sparkles className="w-3 h-3" strokeWidth={2.6} />
                        Luxe casino · TON-native
                    </div>
                    <h1 className="mt-3 font-display text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white max-w-[22ch] leading-[1.05]">
                        Open. <span className="text-gold-bright drop-shadow-[0_2px_18px_rgba(255,215,0,0.45)]">Win.</span> Withdraw <span className="text-gold-300">gifts</span>.
                    </h1>
                    <p className="mt-2 text-[12px] sm:text-sm text-white/65 max-w-[44ch] leading-snug">
                        Provably fair · paid in real Telegram NFT gifts · instant withdrawal queue. {Number(balance) > 0 ? (<>Your balance · <span className="text-gold-bright font-bold tabular-nums">{formatTON(balance)} TON</span></>) : null}
                    </p>
                    {/* Cormorant Garamond stat counters — first slot now wired
                        to real /api/activity/jackpot-24h data (Phase 11.1). */}
                    <div className="mt-5 grid grid-cols-3 gap-3 max-w-md">
                        <JackpotCounter />
                        <HeroStat label="Items paid out" value="71" suffix="gifts" />
                        {/* Positive, accurate framing — cases pay back ~90% (was a
                            scary, and now incorrect, "House edge 15%"). */}
                        <HeroStat label="Avg. payout" value="90" suffix="%" />
                    </div>
                </div>
            </section>

            {/* Phase 11 — Live wins TOP marquee ticker (sticky-ish sub-hero band) */}
            <ActivityTicker />
            {/* Phase 6g — Game-mode banners.
                Phase 7a — Added 3rd banner (Crash).
                Phase 7b — Added 4th banner (Wheel). Grid switches to a 2×2
                stack on mobile so each tile keeps a generous tap area. */}
            <section className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="game-mode-banners">
                <BannerCard
                    to="/battles"
                    title={t("home.banner_pvp_title")}
                    sub={t("home.banner_pvp_sub_short", { defaultValue: "Open in sync." })}
                    icon={Swords}
                    gradient="from-gold-bright/40 via-gold-500/25 to-gold-800/30"
                    accent="text-gold-200"
                    testid="banner-pvp"
                />
                {/* Phase 11.6-A — Roulette banner removed per user request
                    ("полностью убрать рулетку и плинко"). Underlying
                    RoulettePage + WS endpoint are kept dormant so the
                    feature can be re-promoted later by un-commenting. */}
                <BannerCard
                    to="/crash"
                    title={t("home.banner_crash_title", { defaultValue: "Crash" })}
                    sub={t("home.banner_crash_sub", { defaultValue: "Cash out before it explodes." })}
                    icon={Rocket}
                    gradient="from-gold-400/40 via-gold-bright/25 to-red-500/15"
                    accent="text-gold-300"
                    testid="banner-crash"
                />
                <BannerCard
                    to="/wheel"
                    title={t("home.banner_wheel_title", { defaultValue: "Wheel" })}
                    sub={t("home.banner_wheel_sub", { defaultValue: "Spin daily for gifts." })}
                    icon={Disc3}
                    gradient="from-gold-300/45 via-gold-500/25 to-gold-700/30"
                    accent="text-gold-200"
                    testid="banner-wheel"
                />
                {/* Phase 11.6-A — Plinko banner removed per user request.
                    PlinkoPage code is preserved for future re-enable. */}
                <BannerCard
                    to="/mines"
                    title={t("home.banner_mines_title", { defaultValue: "Mines" })}
                    sub={t("home.banner_mines_sub", { defaultValue: "Step around the bombs." })}
                    icon={Bomb}
                    gradient="from-gold-500/40 via-red-500/15 to-gold-900/30"
                    accent="text-gold-200"
                    testid="banner-mines"
                />
            </section>

            {/* Phase 11 / Fix-K — "Top Wins · Last 24h" home section. */}
            <TopWins24h />

            {/* Phase 6g — Whale Vault wide headline banner.
                Phase 6h: two-line title layout so the title never truncates at 390px.
                Phase 6i: route directly to the whale_vault case detail page.
                Phase 11 / Fix-L1: yellow/amber → gold token harmonization (Option B). */}
            <Link
                to="/case/whale_vault"
                data-testid="banner-whale"
                className="relative block overflow-hidden rounded-3xl border border-gold-bright/35 bg-gradient-to-r from-gold-bright/30 via-gold-500/15 to-gold-700/30 group hover:border-gold-bright/65 transition-colors"
                style={{ minHeight: 124 }}
            >
                <div className="absolute -right-6 -top-6 w-44 h-44 bg-gold-bright/15 rounded-full blur-3xl pointer-events-none" />
                <div className="relative flex items-center gap-4 p-4 sm:p-5">
                    <div className="p-3 rounded-2xl bg-gold-bright/15 border border-gold-bright/45 flex-shrink-0">
                        <Crown className="w-7 h-7 text-gold-bright drop-shadow-[0_0_12px_rgba(255,215,0,0.55)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-bright">
                            {t("home.banner_whale_chip")}
                        </div>
                        <div className="font-display text-base sm:text-lg font-black tracking-tight text-white leading-tight">
                            {t("home.banner_whale_title")}
                        </div>
                        <div className="text-[11px] text-white/65 leading-snug mt-0.5">
                            {t("home.banner_whale_sub")}
                        </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gold-bright flex-shrink-0 group-hover:translate-x-0.5 transition" />
                </div>
            </Link>

            {/* Phase 6h — Four category blocks with full-cover background art.
                2-up on mobile (clean 2×2), 4-up on desktop (single row). */}
            <section
                data-testid="category-grid"
                className="grid grid-cols-2 lg:grid-cols-4 gap-2.5"
            >
                {CATEGORY_DEFS.map((c) => {
                    const isActive = active === c.key;
                    const count = counts[c.key] ?? 0;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            onClick={() => onCatTap(c.key)}
                            data-testid={`cat-block-${c.key}`}
                            aria-pressed={isActive}
                            className={`relative aspect-[16/11] sm:aspect-[5/3] lg:aspect-[16/11]
                                rounded-2xl border-2 overflow-hidden text-left
                                transition active:scale-[0.98] ${
                                    isActive
                                        ? c.ring
                                        : "border-white/10 hover:border-white/30"
                                }`}
                            style={{
                                backgroundImage: `url(${c.bg})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        >
                            {/* Legibility mask — diagonal dark wash, heavier at the bottom-left
                                where the label sits, near-transparent in the upper-right where
                                the hero artwork is centred. */}
                            <span
                                aria-hidden
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    background:
                                        "linear-gradient(135deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 55%, rgba(0,0,0,0.7) 100%)",
                                }}
                            />
                            {/* Bottom-left label cluster */}
                            <div className="absolute inset-x-0 bottom-0 p-3">
                                <div
                                    className={`font-display text-sm font-black uppercase tracking-wider text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]`}
                                >
                                    {t(`cases_list.cat_blocks.${c.key}`)}
                                </div>
                                <div
                                    className={`text-[10px] font-bold mt-0.5 tabular-nums ${
                                        isActive ? c.accent : "text-white/75"
                                    } drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]`}
                                >
                                    {t("cases_list.cat_count", { n: count })}
                                </div>
                            </div>
                            {/* Active-state inner ring for extra punch */}
                            {isActive && (
                                <span
                                    aria-hidden
                                    className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15 pointer-events-none"
                                />
                            )}
                        </button>
                    );
                })}
            </section>

            {/* Phase 11 — Section header with new cases banner asset. */}
            <div
                className="relative overflow-hidden rounded-2xl border border-gold-500/20"
                style={{ minHeight: 76 }}
            >
                <div
                    aria-hidden
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: "url(/banners/cases_section_header_banner.webp)" }}
                />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/15" />
                <div className="relative flex items-center gap-3 px-4 py-3">
                    <Diamond className="w-5 h-5 text-gold-bright drop-shadow-[0_0_10px_rgba(255,215,0,0.6)]" />
                    <div className="flex-1">
                        <h2 className="font-display text-sm sm:text-base font-black uppercase tracking-[0.2em] text-white">
                            {active === null ? t("cases_list.section_all") : t(`cases_list.cat_blocks.${active}`)}
                        </h2>
                        <p className="text-[10px] text-gold-200/70 tracking-widest uppercase font-bold">
                            {(active === null
                                ? counts.free + counts.low + counts.middle + counts.high
                                : counts[active] || 0)} cases live
                        </p>
                    </div>
                    <span className="text-gold-bright/65 font-luxe text-2xl leading-none">
                        ✦
                    </span>
                </div>
            </div>

            {loading && (
                <div className="py-10 text-center text-white/40 text-sm">{t("cases_list.loading")}</div>
            )}

            {!loading && visible.map(({ cat, list }) => (
                <section key={cat} data-testid={`category-section-${cat}`} className="space-y-3">
                    {active === null && (
                        <div className="flex items-center gap-2 mt-2">
                            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold tracking-widest border ${CATEGORY_BADGE[cat]}`}>
                                {t(`cases_list.cat_blocks.${cat}`)}
                            </span>
                            <span className="text-[10px] text-white/30 tabular-nums">{list.length}</span>
                        </div>
                    )}
                    {cat === "free" ? (
                        <DailyFreeCaseTile />
                    ) : (
                        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                            {list.map((c) => (
                                <CaseCard
                                    key={c.id}
                                    case={c}
                                    size="md"
                                    headlined={c.id === "whale_vault"}
                                />
                            ))}
                        </div>
                    )}
                </section>
            ))}

            <div className="pt-2 grid grid-cols-3 gap-2">
                <Trust icon={ShieldCheck} label={t("cases_list.trust_provably_fair")} />
                <Trust icon={Sparkles} label={t("cases_list.trust_instant_roll")} />
                <Trust icon={Diamond} label={t("cases_list.trust_mainnet")} />
            </div>
        </main>
    );
};


const BannerCard = ({ to, title, sub, icon: Icon, gradient, accent, testid }) => (
    <Link
        to={to}
        data-testid={testid}
        className={`relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br ${gradient} group transition-transform active:scale-[0.98]`}
        style={{ minHeight: 140 }}
    >
        <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative h-full p-3.5 flex flex-col justify-between">
            <div className={`p-2 rounded-xl bg-white/10 border border-white/15 w-fit ${accent}`}>
                <Icon className="w-5 h-5" strokeWidth={2.2} />
            </div>
            <div>
                <div className={`text-[9px] font-black uppercase tracking-[0.25em] ${accent} mb-1`}>
                    LIVE
                </div>
                <div className="font-display text-base font-black tracking-tight text-white leading-tight">
                    {title}
                </div>
                <div className="text-[10px] text-white/65 leading-snug mt-0.5">
                    {sub}
                </div>
            </div>
        </div>
    </Link>
);


// Phase 6g — Vertical case tile: hero artwork fills the top, info compact below.
// Phase 11.5-B — memoized + content-visibility: auto so off-screen tiles
// skip layout/paint entirely. With 13 ~1 MB case PNGs on iOS Telegram
// WebView the cases grid used to drop frames on scroll; tiles that are
// not in the viewport are now `content-visibility: auto` with an
// `contain-intrinsic-size` hint matching their on-screen footprint
// (image is `aspect-square` + ~64 px of body text). That lets the
// browser cull them from rendering work until the user actually
// scrolls them into view, while still reserving the right amount of
// space so the scrollbar geometry stays stable.
const CaseTile = React.memo(function CaseTile({ c, i, balance, t }) {
    const glow = TIER_GLOW[c.id] || "from-cyber-purple/30 to-cyber-cyan/20";
    const affordable = balance >= c.price_ton;
    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{
                contentVisibility: "auto",
                containIntrinsicSize: "240px 320px",
            }}
        >
            <Link
                to={`/case/${c.id}`}
                data-testid={`case-card-${c.id}`}
                className="block relative overflow-hidden rounded-2xl border border-white/10 bg-cyber-surface group hover:border-cyber-cyan/40 transition-all"
            >
                {/* Flush hero artwork — edge-to-edge, fills the top of the card. */}
                <div className="relative aspect-square bg-cyber-bg">
                    <div className={`absolute inset-0 bg-gradient-to-br ${glow} opacity-50 group-hover:opacity-75 transition pointer-events-none`} />
                    {/* Phase 11.6-B — use lightweight WebP thumbnails
                        (384×256, ~9 KB each) instead of the full 1264×848
                        PNG (~1.1 MB). 14 cases × 1.1 MB = ~15 MB decoded
                        bitmaps used to thrash iOS Telegram WebView memory
                        on scroll. The full-size PNG is still served via
                        /api/static/cases/<slug>.png and reached by
                        CaseDetailPage where the artwork is the hero —
                        only the grid uses thumbnails.

                        We attempted a <picture> element with WebP source
                        + PNG fallback, but in practice React/Chromium
                        kept fetching the full PNG. Direct <img src=webp>
                        with an onError-based PNG fallback is simpler AND
                        works correctly on every browser we tested. */}
                    <img
                        src={caseThumbUrl(c.image_url)}
                        alt={c.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                            // WebP not supported (very old WebView) — fall back to PNG.
                            // Guard against infinite loop by only swapping once.
                            const el = e.currentTarget;
                            if (el.dataset.fallback !== "1") {
                                el.dataset.fallback = "1";
                                el.src = resolveImage(c.image_url);
                            }
                        }}
                    />
                    <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-cyber-surface to-transparent pointer-events-none" />
                    {!affordable && (
                        <div
                            data-testid={`case-locked-${c.id}`}
                            className="absolute top-2 left-2 text-[8px] font-extrabold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-200 border border-rose-400/35"
                        >
                            {t("cases_list.locked_badge", { defaultValue: "LOCKED" })}
                        </div>
                    )}
                </div>
                {/* Info row, tight against the image. */}
                <div className="p-2.5">
                    <h3 className="font-display text-sm font-black tracking-tight text-white truncate leading-tight">
                        {c.name}
                    </h3>
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="inline-flex items-center gap-1 bg-white/8 border border-white/10 rounded-md px-1.5 py-0.5">
                            <Diamond className="w-3 h-3 text-cyber-cyan" strokeWidth={2.5} />
                            <span className="font-display font-bold text-xs tabular-nums">{formatTON(c.price_ton, 0)}</span>
                            <span className="text-[8px] text-white/60 font-bold">TON</span>
                        </span>
                        <span className="text-[9px] uppercase font-bold tracking-wider text-white/40 tabular-nums">
                            {t("cases_list.items_and_rtp", { count: c.item_count, rtp: c.actual_ev_pct.toFixed(0) })}
                        </span>
                    </div>
                    {!affordable && (
                        <div className="text-[9px] text-cyber-magenta font-bold mt-1">
                            {t("cases_list.need_more_ton", { amount: formatTON(c.price_ton - balance) })}
                        </div>
                    )}
                </div>
            </Link>
        </motion.div>
    );
});


const Trust = ({ icon: Icon, label }) => (
    <div className="flex flex-col items-center text-center bg-gold-500/[0.03] border border-gold-500/12 rounded-xl py-2 px-2">
        <Icon className="w-3.5 h-3.5 text-gold-bright mb-1" />
        <span className="text-[9px] uppercase font-bold tracking-wider text-white/55 leading-tight">{label}</span>
    </div>
);

/* Phase 11 — Cormorant Garamond numeral counter for the hero stat row. */
const HeroStat = ({ label, value, suffix }) => (
    <div className="bg-black/40 backdrop-blur-sm border border-gold-500/20 rounded-xl px-3 py-2.5">
        <div className="text-[9px] uppercase tracking-[0.18em] text-gold-300/75 font-bold mb-0.5 truncate">
            {label}
        </div>
        <div className="flex items-baseline gap-1">
            <span className="font-luxe text-2xl sm:text-3xl font-bold text-gold-bright tabular-nums leading-none drop-shadow-[0_0_12px_rgba(255,215,0,0.35)]">
                {value}
            </span>
            <span className="text-[10px] text-gold-300 font-bold uppercase">{suffix}</span>
        </div>
    </div>
);

export default CasesListPage;
