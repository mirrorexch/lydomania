import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
    Diamond, Loader2, Wallet, Send, RefreshCcw, X, Trophy, History, ChevronRight,
} from "lucide-react";
import {
    fetchInventory, fetchCases,
    sellInventoryItem, resolveImage,
} from "@/lib/api";
import {
    RARITY_HEX, RARITY_LABEL, RARITY_ORDER, formatTON,
} from "@/lib/rarity";
import { WithdrawModal } from "@/components/WithdrawModal";

const STATUS_TABS = [
    { value: "all", label: "All" },
    { value: "in_inventory", label: "Owned" },
    { value: "sold", label: "Sold" },
    { value: "withdraw_pending", label: "Pending" },
    { value: "withdrawn", label: "Delivered" },
];

const SORT_OPTIONS = [
    { value: "date_desc", label: "Newest" },
    { value: "date_asc", label: "Oldest" },
    { value: "value_desc", label: "Value ↓" },
    { value: "value_asc", label: "Value ↑" },
];

export const InventoryPage = ({ refreshBalance }) => {
    const [status, setStatus] = useState("in_inventory");
    const [rarity, setRarity] = useState("all");
    const [caseId, setCaseId] = useState("all");
    const [sort, setSort] = useState("date_desc");
    const [items, setItems] = useState([]);
    const [totals, setTotals] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(null);
    const [cases, setCases] = useState([]);
    const [withdrawTarget, setWithdrawTarget] = useState(null);

    useEffect(() => {
        fetchCases().then(setCases).catch(() => {});
    }, []);

    const reload = async () => {
        setLoading(true);
        try {
            const r = await fetchInventory({ status, rarity, case_id: caseId, sort });
            setItems(r.items);
            setTotals(r.totals);
        } catch (e) {
            toast.error("Failed to load collection", { description: e?.message });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, rarity, caseId, sort]);

    const handleSell = async (item) => {
        if (busy) return;
        setBusy(item.id);
        try {
            const newBal = await sellInventoryItem(item.id);
            toast.success(`Sold ${item.item_name} · +${formatTON(item.payout_ton)} TON`);
            refreshBalance?.(newBal);
            await reload();
        } catch (e) {
            toast.error("Sell failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(null);
        }
    };

    const handleWithdraw = (item) => {
        if (busy) return;
        setWithdrawTarget(item);
    };

    const handleSellAllVisible = async () => {
        if (busy) return;
        const sellable = items.filter(i => i.status === "in_inventory");
        if (sellable.length === 0) return;
        if (!window.confirm(`Sell all ${sellable.length} visible items for ${formatTON(sellable.reduce((s,i)=>s+i.payout_ton,0))} TON?`)) return;
        setBusy("all");
        let success = 0, failed = 0;
        let lastBal = null;
        for (const it of sellable) {
            try {
                lastBal = await sellInventoryItem(it.id);
                success++;
            } catch { failed++; }
        }
        if (lastBal !== null) refreshBalance?.(lastBal);
        toast.success(`Sold ${success}${failed?` · ${failed} failed`:""}`);
        await reload();
        setBusy(null);
    };

    const rarityChips = useMemo(() => {
        if (!totals) return RARITY_ORDER;
        return RARITY_ORDER.filter(r => (totals.count_by_rarity?.[r] || 0) > 0);
    }, [totals]);

    return (
        <main className="max-w-[430px] mx-auto px-4 pt-3 pb-24" data-testid="inventory-page">
            {/* Title row */}
            <div className="flex items-baseline justify-between mb-3">
                <h1 className="font-display text-2xl font-black tracking-tight">Collection</h1>
                <div className="flex items-center gap-2">
                    <Link
                        to="/withdrawals"
                        data-testid="inv-withdrawals-link"
                        className="text-[10px] font-bold uppercase tracking-wider text-cyber-cyan hover:text-cyber-purple inline-flex items-center gap-1"
                    >
                        Withdrawals <ChevronRight className="w-3 h-3" />
                    </Link>
                    <button onClick={reload} className="text-white/40 hover:text-cyber-cyan transition p-1" data-testid="inv-refresh-btn" aria-label="Refresh">
                        <RefreshCcw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Totals header */}
            <div className="grid grid-cols-2 gap-2 mb-4" data-testid="inv-totals">
                <div className="rounded-xl border border-cyber-cyan/30 bg-gradient-to-br from-cyber-cyan/10 to-cyber-purple/10 p-3">
                    <div className="text-[9px] uppercase font-bold tracking-[0.2em] text-cyber-cyan inline-flex items-center gap-1">
                        <Trophy className="w-3 h-3" /> Owned value
                    </div>
                    <div className="font-display text-xl font-black mt-0.5 tabular-nums">
                        <span className="text-white">{formatTON(totals?.total_value_unsold_ton)}</span>
                        <span className="text-[10px] text-white/40 ml-1 font-bold">TON</span>
                    </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-cyber-surface/60 p-3">
                    <div className="text-[9px] uppercase font-bold tracking-[0.2em] text-white/50 inline-flex items-center gap-1">
                        <History className="w-3 h-3" /> All-time won
                    </div>
                    <div className="font-display text-xl font-black mt-0.5 tabular-nums">
                        <span className="text-white">{formatTON(totals?.total_value_all_time_ton)}</span>
                        <span className="text-[10px] text-white/40 ml-1 font-bold">TON</span>
                    </div>
                </div>
            </div>

            {/* Status tabs */}
            <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
                {STATUS_TABS.map((t) => {
                    const n = totals?.count_by_status?.[t.value] ?? (t.value === "all" ? totals?.total_count : 0);
                    return (
                        <button
                            key={t.value}
                            data-testid={`inv-tab-${t.value}`}
                            onClick={() => setStatus(t.value)}
                            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border whitespace-nowrap transition inline-flex items-center gap-1 ${
                                status === t.value
                                    ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                            }`}
                        >
                            {t.label}
                            {totals && n > 0 && (
                                <span className={status === t.value ? "text-cyber-cyan/80" : "text-white/40"}>
                                    {n}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Rarity + Case + Sort row */}
            <div className="flex flex-wrap gap-1.5 items-center mb-4 text-xs">
                <select
                    data-testid="inv-rarity-select"
                    value={rarity}
                    onChange={(e) => setRarity(e.target.value)}
                    className="bg-cyber-surface border border-white/10 rounded-md px-2 py-1 text-white/80 focus:border-cyber-cyan outline-none"
                >
                    <option value="all">All rarities</option>
                    {rarityChips.map((r) => (
                        <option key={r} value={r} style={{ color: RARITY_HEX[r] }}>
                            {RARITY_LABEL[r]} · {totals?.count_by_rarity?.[r] || 0}
                        </option>
                    ))}
                </select>
                <select
                    data-testid="inv-case-select"
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className="bg-cyber-surface border border-white/10 rounded-md px-2 py-1 text-white/80 focus:border-cyber-cyan outline-none"
                >
                    <option value="all">All cases</option>
                    {cases.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <select
                    data-testid="inv-sort-select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="bg-cyber-surface border border-white/10 rounded-md px-2 py-1 text-white/80 focus:border-cyber-cyan outline-none ml-auto"
                >
                    {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            {/* Sell-all visible button (only when on Owned tab w/ items) */}
            {status === "in_inventory" && items.length > 0 && (
                <button
                    data-testid="inv-sell-all-btn"
                    onClick={handleSellAllVisible}
                    disabled={busy === "all"}
                    className="w-full text-[11px] font-bold uppercase tracking-wider bg-gradient-to-r from-cyber-cyan/20 to-cyber-purple/20 border border-cyber-cyan/40 hover:border-cyber-cyan/70 text-cyber-cyan rounded-lg py-2 mb-3 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                    <Wallet className="w-3 h-3" /> Sell all visible ({items.length})
                </button>
            )}

            {/* Body */}
            {loading ? (
                <div className="py-10 text-center text-white/40 text-sm inline-flex items-center justify-center gap-2 w-full">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
            ) : items.length === 0 ? (
                <div className="py-16 text-center" data-testid="inv-empty">
                    <div className="text-2xl mb-2">📭</div>
                    <div className="text-sm text-white/50">Nothing here yet.</div>
                    <div className="text-xs text-white/35 mt-1">
                        {status === "in_inventory"
                            ? "Open a case — your wins land here."
                            : "Try a different filter."}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2" data-testid="inv-grid">
                    {items.map((it, i) => {
                        const color = RARITY_HEX[it.rarity] || RARITY_HEX.common;
                        return (
                            <motion.div
                                key={it.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.025, duration: 0.3 }}
                                data-testid={`inv-tile-${it.id}`}
                                className="flex flex-col bg-cyber-surface rounded-xl overflow-hidden relative"
                                style={{ border: `1px solid ${color}33` }}
                            >
                                {/* image */}
                                <div className="relative aspect-square bg-cyber-bg flex items-center justify-center" style={{ boxShadow: `inset 0 0 14px ${color}22` }}>
                                    <img
                                        src={resolveImage(it.image_url)}
                                        alt={it.item_name}
                                        className="w-3/4 h-3/4 object-contain drop-shadow-lg"
                                        style={{ filter: `drop-shadow(0 0 14px ${color}77)` }}
                                        draggable={false}
                                    />
                                    {/* rarity chip */}
                                    <span
                                        className="absolute top-1.5 left-1.5 text-[8px] font-black uppercase tracking-[0.15em] px-1.5 py-0.5 rounded"
                                        style={{ color, background: `${color}22`, border: `1px solid ${color}66` }}
                                    >
                                        {RARITY_LABEL[it.rarity]}
                                    </span>
                                    {/* status chip */}
                                    {it.status !== "in_inventory" && (
                                        <span className="absolute top-1.5 right-1.5 text-[8px] font-black uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-black/70 text-white/70 border border-white/15">
                                            {it.status === "withdraw_pending" ? "pending" : it.status}
                                        </span>
                                    )}
                                </div>
                                {/* body */}
                                <div className="p-2.5">
                                    <div className="text-xs font-bold text-white truncate" title={it.item_name}>
                                        {it.item_name}
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-white">
                                            <Diamond className="w-3 h-3 text-cyber-cyan" />
                                            {formatTON(it.payout_ton)}
                                        </span>
                                        <span className="text-[8px] uppercase font-bold tracking-wider text-white/35 truncate ml-1" title={it.case_name || it.case_id}>
                                            {it.case_name || it.case_id}
                                        </span>
                                    </div>
                                    {/* actions */}
                                    {it.status === "in_inventory" && (
                                        <div className="flex gap-1 mt-2">
                                            <button
                                                data-testid={`inv-sell-${it.id}`}
                                                disabled={busy === it.id}
                                                onClick={() => handleSell(it)}
                                                className="flex-1 text-[9px] font-black uppercase tracking-wider bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg rounded-md py-1.5 disabled:opacity-50"
                                            >
                                                Sell
                                            </button>
                                            <button
                                                data-testid={`inv-withdraw-${it.id}`}
                                                disabled={busy === it.id}
                                                onClick={() => handleWithdraw(it)}
                                                className="flex-1 text-[9px] font-black uppercase tracking-wider bg-white/5 border border-white/15 hover:bg-white/10 transition text-white rounded-md py-1.5 disabled:opacity-50"
                                            >
                                                Withdraw
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}
            <WithdrawModal
                item={withdrawTarget}
                open={!!withdrawTarget}
                onClose={() => setWithdrawTarget(null)}
                onConfirmed={() => { reload(); }}
            />
        </main>
    );
};
