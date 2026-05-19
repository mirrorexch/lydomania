import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Trophy, TrendingUp, Sparkles, Users as UsersIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminLeaderboard } from "@/lib/api";

const RANK_GLOW = {
    1: "shadow-[0_0_22px_rgba(250,204,21,0.55)] border-amber-400/60 bg-amber-400/8",
    2: "shadow-[0_0_18px_rgba(203,213,225,0.45)] border-slate-300/55 bg-slate-300/6",
    3: "shadow-[0_0_18px_rgba(217,119,6,0.45)] border-orange-500/55 bg-orange-500/8",
};
const RANK_LABEL = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Tabs({ items, value, onChange, testidPrefix }) {
    return (
        <div className="inline-flex rounded-lg bg-cyber-bg/70 border border-white/8 p-0.5 gap-0.5">
            {items.map((it) => {
                const Icon = it.icon;
                const active = it.key === value;
                return (
                    <button
                        key={it.key}
                        type="button"
                        onClick={() => onChange(it.key)}
                        data-testid={`${testidPrefix}-${it.key}`}
                        className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md transition
                            ${active
                                ? "bg-emerald-500/22 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.4)]"
                                : "text-white/55 hover:text-white/85"}`}
                    >
                        {Icon && <Icon className="w-3 h-3" />}
                        {it.label}
                    </button>
                );
            })}
        </div>
    );
}

function Row({ row, unit }) {
    const { t } = useTranslation();
    const ringClass = RANK_GLOW[row.rank] || "border-white/8 bg-cyber-bg/45";
    const ribbon = RANK_LABEL[row.rank] || `#${row.rank}`;
    const display = (row.username || row.first_name || `user_${(row.telegram_id ?? "x").toString().slice(-4)}`).toString();
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(row.rank * 0.012, 0.4) }}
            data-testid={`leaderboard-row-${row.rank}`}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${ringClass}
                ${row.is_self ? "ring-2 ring-emerald-400/40" : ""}`}
        >
            <div className={`text-[12px] font-black font-mono min-w-[2.25rem] tabular-nums ${row.rank <= 3 ? "" : "text-white/45"}`}>
                {ribbon}
            </div>
            {row.photo_url
                ? <img src={row.photo_url} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-white/15" />
                : <div className="w-7 h-7 rounded-full bg-cyber-bg/80 ring-1 ring-white/15 flex items-center justify-center text-[10px] font-bold text-white/45">
                    {display.charAt(0).toUpperCase()}
                </div>
            }
            <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-white/90 truncate">
                    {display}
                    {row.is_self && <span className="ml-1.5 text-[9px] text-emerald-300 font-mono uppercase">{t("leaderboard.you")}</span>}
                </div>
                {row.extra && Object.keys(row.extra).length > 0 && (
                    <div className="text-[9.5px] text-white/40 truncate">
                        {row.extra.opens != null && <>{t("leaderboard.extra_opens", { n: row.extra.opens })}</>}
                        {row.extra.case_id && <>{" · "}{row.extra.case_id} · {row.extra.item_slug}</>}
                        {row.extra.credits != null && <>{" · "}{t("leaderboard.extra_credits", { n: row.extra.credits })}</>}
                    </div>
                )}
            </div>
            <div className="text-right">
                <div className="text-[12.5px] font-black text-emerald-200 tabular-nums">
                    {Number(row.value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="text-[9px] text-white/35 uppercase tracking-wider">{unit}</div>
            </div>
        </motion.div>
    );
}

export const LeaderboardPage = () => {
    const { t } = useTranslation();
    const [view, setView] = useState("wagered");
    const [period, setPeriod] = useState("week");
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);

    const VIEWS = [
        { key: "wagered", label: t("leaderboard.view_wagered"), icon: TrendingUp, unit: "TON" },
        { key: "won_single", label: t("leaderboard.view_top_win"), icon: Sparkles, unit: "TON" },
        { key: "referrers", label: t("leaderboard.view_referrers"), icon: UsersIcon, unit: "TON" },
    ];
    const PERIODS = [
        { key: "week", label: t("leaderboard.period_week") },
        { key: "all", label: t("leaderboard.period_all") },
    ];

    const load = useCallback(async () => {
        setBusy(true); setErr(null);
        try {
            const r = await adminLeaderboard(view, period, 100);
            setData(r);
        } catch (e) {
            setErr(e?.response?.data?.detail || e?.message || t("admin.digest.load_failed"));
            setData(null);
        } finally {
            setBusy(false);
        }
    }, [view, period, t]);

    useEffect(() => { load(); }, [load]);

    const viewMeta = VIEWS.find((v) => v.key === view) || VIEWS[0];

    return (
        <div data-testid="leaderboard-page" className="mx-auto px-4 sm:px-6 pt-3 pb-24 lg:pb-6 space-y-3
            max-w-[430px] sm:max-w-[640px] lg:max-w-[760px]">
            {/* Phase 6h — Hero banner: gold podium silhouettes with confetti.
                Phase 6i: fit full subject vertically — trophies never crop. */}
            <header
                data-testid="leaderboard-hero"
                className="relative overflow-hidden rounded-3xl border border-white/10 -mx-1"
                style={{
                    backgroundImage: "url(/banners/leaderboard.png)",
                    backgroundSize: "auto 100%",
                    backgroundPosition: "right center",
                    backgroundRepeat: "no-repeat",
                    backgroundColor: "#0a0a14",
                    minHeight: 180,
                }}
            >
                <span
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background:
                            "linear-gradient(90deg, rgba(10,10,20,0.88) 0%, rgba(10,10,20,0.45) 60%, rgba(10,10,20,0.05) 100%)",
                    }}
                />
                <div className="relative flex items-end justify-between gap-3 p-4 sm:p-5 min-h-[150px]">
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-bright font-bold flex items-center gap-1.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
                            <Trophy className="w-3 h-3" /> {t("leaderboard.tag", { defaultValue: "LEADERBOARD" })}
                        </div>
                        <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-white mt-1 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                            {t("leaderboard.title")}
                        </h1>
                        <p className="text-[11px] sm:text-xs text-white/80 mt-1 max-w-[14rem] leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                            {t("leaderboard.subtitle", { defaultValue: "Top winners — by wagers, single drops and referrals." })}
                        </p>
                    </div>
                </div>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                <Tabs items={VIEWS} value={view} onChange={setView} testidPrefix="leaderboard-view-tab" />
                <div className="flex-1" />
                <Tabs items={PERIODS} value={period} onChange={setPeriod} testidPrefix="leaderboard-period-tab" />
            </div>

            {data?.me && data.me.rank > 100 && (
                <div className="mb-2.5 text-[10.5px] uppercase tracking-wider font-bold text-emerald-300/85">
                    {t("leaderboard.your_rank", { rank: data.me.rank })}
                </div>
            )}
            {data?.me && data.me.rank > 100 && <Row row={data.me} unit={viewMeta.unit} />}
            {data?.me_rank == null && period === "week" && (
                <div className="text-[10.5px] text-white/40 mb-2">
                    {t("leaderboard.no_activity_week")}
                </div>
            )}

            {err && (
                <div className="text-[11.5px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-1.5">{err}</div>
            )}
            {busy && !data && <div className="flex items-center justify-center py-10 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>}

            {data && data.rows.length === 0 && !err && (
                <div className="text-center py-12 text-white/40 text-[12px]">
                    {t("leaderboard.empty", {
                        view: viewMeta.label,
                        period: period === "week" ? t("leaderboard.this_week_short") : t("leaderboard.all_time_short"),
                    })}
                </div>
            )}

            {data && data.rows.length > 0 && (
                <div className="space-y-1.5">
                    {data.rows.map((r) => <Row key={`${r.rank}-${r.user_id}`} row={r} unit={viewMeta.unit} />)}
                </div>
            )}
            {data?.generated_at && (
                <div className="text-[9px] text-white/25 uppercase tracking-wider text-center mt-4">
                    {t("leaderboard.updated", { when: new Date(data.generated_at).toLocaleString() })}
                </div>
            )}
        </div>
    );
};

export default LeaderboardPage;
