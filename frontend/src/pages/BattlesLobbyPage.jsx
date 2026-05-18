/**
 * Phase 6d — Battles Lobby page.
 *
 * - Top: "Create Battle" CTA → opens a create-battle modal
 * - List: open / ready / rolling battles, live via WS lobby channel
 * - Filters: mode / players / entry range
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Swords, Users as UsersIcon, Plus, X, Trash2, ChevronRight, Filter } from "lucide-react";

import { fetchCases, http, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { openBattlesLobbySocket } from "@/lib/battlesWs";
import { Button } from "@/components/ui/button";

const MODE_COLOR = {
    high_wins: "border-emerald-400/40 text-emerald-300 bg-emerald-400/10",
    low_wins:  "border-rose-400/40 text-rose-300 bg-rose-400/10",
};
const STATUS_COLOR = {
    open:    "bg-cyan-400/15 text-cyan-200 border-cyan-400/30",
    ready:   "bg-yellow-400/15 text-yellow-300 border-yellow-400/30",
    rolling: "bg-purple-400/15 text-purple-300 border-purple-400/30",
};

export default function BattlesLobbyPage({ user, refreshBalance }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [filterMode, setFilterMode] = useState("any");
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        const conn = openBattlesLobbySocket({
            onMessage: (msg) => {
                if (msg.type === "lobby_snapshot") {
                    setRows(msg.rows || []);
                } else if (msg.type === "battle_created" || msg.type === "battle_updated") {
                    setRows((prev) => {
                        const next = prev.filter((b) => b.battle_id !== msg.battle.battle_id);
                        return [msg.battle, ...next].slice(0, 50);
                    });
                } else if (msg.type === "battle_completed" || msg.type === "battle_cancelled") {
                    setRows((prev) => prev.filter((b) => b.battle_id !== msg.battle.battle_id));
                }
            },
        });
        return () => conn.close();
    }, []);

    const filtered = useMemo(() => {
        return rows.filter((b) => filterMode === "any" || b.mode === filterMode);
    }, [rows, filterMode]);

    return (
        <main className="mx-auto px-4 sm:px-6 pt-4 pb-24 lg:pb-6 space-y-5 max-w-[430px] sm:max-w-[760px] lg:max-w-[1100px]"
              data-testid="battles-lobby-page">

            <header className="flex items-center justify-between gap-3 sticky top-[52px] lg:top-0 z-20 -mx-1 px-1 py-2 bg-cyber-bg/85 backdrop-blur-xl">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-bold flex items-center gap-1.5">
                        <Swords className="w-3 h-3" /> {t("battles.tag")}
                    </div>
                    <h1 className="text-xl sm:text-2xl font-display font-extrabold tracking-tight">
                        {t("battles.lobby_title")}
                    </h1>
                </div>
                <Button
                    data-testid="battles-create-btn"
                    onClick={() => setShowCreate(true)}
                    className="bg-gradient-to-r from-amber-400 to-rose-500 hover:from-amber-300 hover:to-rose-400 text-black font-bold"
                >
                    <Plus className="w-4 h-4 mr-1" />{t("battles.create_cta")}
                </Button>
            </header>

            <div className="flex items-center gap-2 flex-wrap" data-testid="battles-filters">
                <Filter className="w-3.5 h-3.5 text-white/40" />
                <FilterChip active={filterMode === "any"} onClick={() => setFilterMode("any")}>{t("battles.filter.any")}</FilterChip>
                <FilterChip active={filterMode === "high_wins"} onClick={() => setFilterMode("high_wins")}>{t("battles.mode.high_wins")}</FilterChip>
                <FilterChip active={filterMode === "low_wins"} onClick={() => setFilterMode("low_wins")}>{t("battles.mode.low_wins")}</FilterChip>
            </div>

            <div className="space-y-3" data-testid="battles-list">
                {filtered.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] py-12 text-center">
                        <Swords className="w-8 h-8 mx-auto text-white/20 mb-2" />
                        <div className="text-sm text-white/40">{t("battles.empty")}</div>
                    </div>
                )}
                {filtered.map((b) => (
                    <BattleCard key={b.battle_id} b={b} user={user} refreshBalance={refreshBalance} />
                ))}
            </div>

            {showCreate && (
                <CreateBattleModal
                    onClose={() => setShowCreate(false)}
                    onCreated={(battleId) => {
                        setShowCreate(false);
                        if (refreshBalance) refreshBalance();
                        navigate(`/battles/${battleId}`);
                    }}
                />
            )}
        </main>
    );
}


const FilterChip = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition ${
            active ? "bg-cyan-400/15 text-cyan-200 border-cyan-400/40"
                   : "bg-white/[0.04] text-white/50 border-white/10 hover:text-white/80"
        }`}
    >{children}</button>
);


function BattleCard({ b, user, refreshBalance }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const filled = b.seats.filter((s) => s.user_id).length;
    const total = b.players;
    const mine = b.seats.some((s) => s.user_id === user?.id);
    const isOpen = b.status === "open";
    const canJoin = isOpen && !mine && filled < total;

    const join = async (e) => {
        e.stopPropagation();
        try {
            await http.post(`/battles/${b.battle_id}/join`);
            if (refreshBalance) refreshBalance();
            toast.success(t("battles.toast.joined"));
            navigate(`/battles/${b.battle_id}`);
        } catch (err) {
            toast.error(err?.response?.data?.detail || "join failed");
        }
    };

    return (
        <Link
            to={`/battles/${b.battle_id}`}
            data-testid={`battle-row-${b.battle_id}`}
            className="block relative overflow-hidden rounded-2xl border border-white/10 bg-cyber-surface/60 hover:border-amber-400/40 p-4 transition"
        >
            <div className="flex flex-wrap items-center gap-3">
                <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md border ${MODE_COLOR[b.mode] || ""}`}>
                    {t(`battles.mode.${b.mode}`)}
                </span>
                <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md border ${STATUS_COLOR[b.status] || ""}`}>
                    {t(`battles.status.${b.status}`)}
                </span>
                <div className="flex items-center gap-1 text-xs text-white/60">
                    <UsersIcon className="w-3 h-3" />
                    <span className="font-mono">{filled}/{total}</span>
                </div>
                <div className="ml-auto flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-[9px] uppercase tracking-wider text-white/40">{t("battles.entry")}</div>
                        <div className="font-display font-bold text-base text-cyan-200 tabular-nums">{formatTON(b.entry_ton)} TON</div>
                    </div>
                    {canJoin && (
                        <Button onClick={join} data-testid={`battle-join-${b.battle_id}`}
                                className="bg-cyan-400 hover:bg-cyan-300 text-black font-bold">
                            {t("battles.join")}
                        </Button>
                    )}
                    {mine && (
                        <Button onClick={(e) => { e.stopPropagation(); navigate(`/battles/${b.battle_id}`); }}
                                className="bg-white/10 hover:bg-white/20 text-white">
                            {t("battles.open")}<ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1" data-testid={`battle-sequence-${b.battle_id}`}>
                {b.case_sequence.map((slug, i) => (
                    <div key={i} className="flex-shrink-0 px-2 py-1 rounded-md bg-white/[0.05] border border-white/10 text-[10px] font-mono text-white/70">
                        #{i + 1} · {slug}
                    </div>
                ))}
                <div className="ml-auto text-[10px] text-white/40 flex-shrink-0">
                    Pot {formatTON(b.pot_ton)} TON · rake {b.house_rake_pct}%
                </div>
            </div>
        </Link>
    );
}


function CreateBattleModal({ onClose, onCreated }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState("high_wins");
    const [players, setPlayers] = useState(2);
    const [pickedSlugs, setPickedSlugs] = useState([]);
    const [cases, setCases] = useState([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            try { setCases(await fetchCases()); } catch { /* */ }
        })();
    }, []);

    const totalEntry = useMemo(() => {
        const map = Object.fromEntries(cases.map((c) => [c.id, c.price_ton]));
        return pickedSlugs.reduce((s, slug) => s + (map[slug] || 0), 0);
    }, [pickedSlugs, cases]);

    const addCase = (slug) => {
        if (pickedSlugs.length >= 6) { toast.error("max 6 cases"); return; }
        setPickedSlugs([...pickedSlugs, slug]);
    };
    const removeCase = (idx) => setPickedSlugs(pickedSlugs.filter((_, i) => i !== idx));

    const submit = async () => {
        if (pickedSlugs.length < 2) { toast.error(t("battles.create.need_min_cases")); return; }
        setBusy(true);
        try {
            const { data } = await http.post("/battles", {
                mode,
                players,
                case_sequence: pickedSlugs,
            });
            toast.success(t("battles.toast.created"));
            onCreated(data.battle_id);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "create failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3 backdrop-blur-sm"
             data-testid="battles-create-modal"
             onClick={onClose}>
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-cyber-surface border border-amber-400/30 rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display font-bold text-lg">{t("battles.create.title")}</h2>
                    <button onClick={onClose}><X className="w-5 h-5 text-white/50 hover:text-white" /></button>
                </div>

                <div className="space-y-4">
                    <Section label={t("battles.create.mode")}>
                        {["high_wins", "low_wins"].map((m) => (
                            <button key={m} onClick={() => setMode(m)}
                                data-testid={`battles-mode-${m}`}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border ${
                                    mode === m ? MODE_COLOR[m] : "border-white/10 bg-white/[0.03] text-white/50"
                                }`}>{t(`battles.mode.${m}`)}</button>
                        ))}
                    </Section>

                    <Section label={t("battles.create.players")}>
                        {[2, 3, 4].map((n) => (
                            <button key={n} onClick={() => setPlayers(n)}
                                data-testid={`battles-players-${n}`}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border ${
                                    players === n ? "bg-cyan-400/15 text-cyan-200 border-cyan-400/40"
                                                : "border-white/10 bg-white/[0.03] text-white/50"
                                }`}>{n} {t("battles.players_word")}</button>
                        ))}
                    </Section>

                    <Section label={t("battles.create.picked", { n: pickedSlugs.length })}>
                        {pickedSlugs.length === 0 && (
                            <span className="text-[11px] text-white/40">{t("battles.create.pick_hint")}</span>
                        )}
                        {pickedSlugs.map((s, i) => (
                            <button key={i} onClick={() => removeCase(i)}
                                className="px-2 py-1 rounded-md bg-white/[0.06] border border-white/10 text-[11px] font-mono text-white/80 flex items-center gap-1">
                                #{i + 1} {s}<Trash2 className="w-3 h-3" />
                            </button>
                        ))}
                    </Section>

                    <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">
                        {t("battles.create.add_cases")}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1" data-testid="battles-case-picker">
                        {cases.filter((c) => c.price_ton > 0).map((c) => (
                            <button key={c.id} onClick={() => addCase(c.id)}
                                data-testid={`battles-add-case-${c.id}`}
                                className="text-left rounded-lg border border-white/10 bg-white/[0.03] hover:border-cyan-400/40 transition p-2">
                                <div className="flex items-center gap-2">
                                    <img src={resolveImage(c.image_url)} alt={c.name}
                                         className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-bold truncate">{c.name}</div>
                                        <div className="text-[10px] text-cyan-300 tabular-nums">{formatTON(c.price_ton)} TON</div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.05] p-3 space-y-1 text-xs">
                        <Row k={t("battles.entry")} v={`${formatTON(totalEntry)} TON`} />
                        <Row k={t("battles.create.pot_est")} v={`${formatTON(totalEntry * players)} TON`} />
                    </div>

                    <Button onClick={submit} disabled={busy || pickedSlugs.length < 2}
                        data-testid="battles-create-submit"
                        className="w-full bg-gradient-to-r from-amber-400 to-rose-500 text-black font-bold disabled:opacity-50">
                        {busy ? t("battles.create.creating") : t("battles.create.confirm", { ton: formatTON(totalEntry) })}
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

const Section = ({ label, children }) => (
    <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">{label}</div>
        <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
);
const Row = ({ k, v }) => (
    <div className="flex items-center justify-between">
        <span className="text-white/50">{k}</span><span className="font-mono text-white">{v}</span>
    </div>
);
