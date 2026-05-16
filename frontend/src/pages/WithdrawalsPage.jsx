import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    RefreshCcw, ExternalLink, Loader2, CheckCircle2, XCircle, Clock,
    Hourglass, X as XIcon, Diamond, Copy, ArrowUpRight,
} from "lucide-react";
import { fetchMyWithdrawals, cancelMyWithdrawal, resolveImage } from "@/lib/api";
import { RARITY_HEX, RARITY_LABEL, formatTON } from "@/lib/rarity";

const STATUS_TABS = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "processing", label: "Processing" },
    { value: "fulfilled", label: "Delivered" },
    { value: "rejected", label: "Rejected" },
    { value: "cancelled", label: "Cancelled" },
];

const STATUS_META = {
    pending: { icon: Hourglass, color: "#fbbf24", label: "PENDING" },
    processing: { icon: Loader2, color: "#22d3ee", label: "PROCESSING", spin: true },
    fulfilled: { icon: CheckCircle2, color: "#34d399", label: "DELIVERED" },
    rejected: { icon: XCircle, color: "#f87171", label: "REJECTED" },
    cancelled: { icon: XIcon, color: "#9ca3af", label: "CANCELLED" },
};

const fmtRelative = (iso) => {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
};

const StatusChip = ({ status }) => {
    const m = STATUS_META[status] || STATUS_META.pending;
    const Icon = m.icon;
    return (
        <span
            className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md border"
            style={{
                color: m.color,
                background: `${m.color}15`,
                borderColor: `${m.color}55`,
            }}
        >
            <Icon className={`w-2.5 h-2.5 ${m.spin ? "animate-spin" : ""}`} />
            {m.label}
        </span>
    );
};

const Row = ({ w, onCancel, busy }) => {
    const color = RARITY_HEX[w.item_rarity] || RARITY_HEX.common;
    const copyAddress = () => {
        navigator.clipboard?.writeText(w.destination_address);
        toast.success("Address copied");
    };
    const tonscan = w.fulfillment_tx_hash
        ? `https://tonviewer.com/transaction/${w.fulfillment_tx_hash}`
        : null;
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid={`withdrawal-row-${w.id}`}
            className="rounded-xl bg-cyber-surface border border-white/10 p-3"
            style={{ boxShadow: `inset 0 0 14px ${color}11` }}
        >
            <div className="flex items-start gap-3">
                <div
                    className="w-14 h-14 rounded-lg bg-cyber-bg flex items-center justify-center flex-shrink-0"
                    style={{ boxShadow: `inset 0 0 12px ${color}33`, border: `1px solid ${color}44` }}
                >
                    <img
                        src={resolveImage(w.item_image_url)}
                        alt={w.item_name}
                        className="w-10 h-10 object-contain"
                        style={{ filter: `drop-shadow(0 0 8px ${color}88)` }}
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color }}>
                                {RARITY_LABEL[w.item_rarity]}
                            </div>
                            <div className="font-bold text-sm truncate">{w.item_name}</div>
                            <div className="inline-flex items-center gap-1 text-xs font-mono font-bold mt-0.5">
                                <Diamond className="w-3 h-3 text-cyber-cyan" />
                                {formatTON(w.payout_ton)}
                                <span className="text-[9px] text-white/40 ml-0.5">TON</span>
                            </div>
                        </div>
                        <StatusChip status={w.status} />
                    </div>
                    {/* destination address */}
                    <button
                        onClick={copyAddress}
                        className="flex items-center gap-1 mt-1.5 text-[10px] text-white/45 hover:text-white/80 transition"
                    >
                        <Copy className="w-2.5 h-2.5" />
                        <span className="font-mono">
                            {w.destination_address.slice(0, 6)}…{w.destination_address.slice(-6)}
                        </span>
                    </button>
                </div>
            </div>

            {/* Footer: timestamps & actions */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/8">
                <div className="text-[10px] text-white/40 inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {fmtRelative(w.fulfilled_at || w.rejected_at || w.cancelled_at || w.requested_at)}
                </div>
                <div className="flex items-center gap-1.5">
                    {tonscan && (
                        <a
                            href={tonscan}
                            target="_blank"
                            rel="noreferrer"
                            data-testid={`withdrawal-tonscan-${w.id}`}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-cyber-cyan hover:text-cyber-purple px-2 py-1 rounded-md bg-white/5 border border-white/10"
                        >
                            <ExternalLink className="w-2.5 h-2.5" /> TonViewer
                        </a>
                    )}
                    {w.status === "pending" && (
                        <button
                            onClick={() => onCancel?.(w)}
                            disabled={busy}
                            data-testid={`withdrawal-cancel-${w.id}`}
                            className="text-[10px] font-bold text-white/60 hover:text-red-400 px-2 py-1 rounded-md bg-white/5 border border-white/10 disabled:opacity-40"
                        >
                            Cancel
                        </button>
                    )}
                    {w.status === "rejected" && w.rejection_reason && (
                        <span className="text-[10px] text-red-300/80 italic truncate max-w-[180px]" title={w.rejection_reason}>
                            “{w.rejection_reason}”
                        </span>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export const WithdrawalsPage = () => {
    const [items, setItems] = useState([]);
    const [status, setStatus] = useState("all");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetchMyWithdrawals(status);
            setItems(r);
        } catch (e) {
            toast.error("Failed to load withdrawals", { description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => { reload(); }, [reload]);

    const handleCancel = async (w) => {
        if (busy) return;
        if (!window.confirm(`Cancel withdrawal of ${w.item_name}? The item will return to your collection.`)) return;
        setBusy(true);
        try {
            await cancelMyWithdrawal(w.id);
            toast.success("Withdrawal cancelled");
            await reload();
        } catch (e) {
            toast.error("Cancel failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="max-w-[430px] mx-auto px-4 pt-3 pb-24" data-testid="withdrawals-page">
            {/* Title row */}
            <div className="flex items-baseline justify-between mb-3">
                <div>
                    <h1 className="font-display text-2xl font-black tracking-tight inline-flex items-center gap-2">
                        Withdrawals
                        <ArrowUpRight className="w-5 h-5 text-cyber-cyan" />
                    </h1>
                    <div className="text-[11px] text-white/45 mt-0.5">
                        Track your NFT gift deliveries
                    </div>
                </div>
                <button
                    onClick={reload}
                    data-testid="withdrawals-refresh-btn"
                    className="text-white/40 hover:text-cyber-cyan transition p-1"
                    aria-label="Refresh"
                >
                    <RefreshCcw className="w-4 h-4" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {STATUS_TABS.map((t) => (
                    <button
                        key={t.value}
                        onClick={() => setStatus(t.value)}
                        data-testid={`withdrawals-tab-${t.value}`}
                        className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border whitespace-nowrap transition ${
                            status === t.value
                                ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16 text-white/40">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-cyber-surface/40 p-8 text-center">
                    <div className="text-2xl mb-2">📦</div>
                    <div className="text-sm text-white/50">No withdrawals here yet.</div>
                    <div className="text-xs text-white/35 mt-1">
                        Open a case, then withdraw a gift to your wallet.
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2" data-testid="withdrawals-list">
                    {items.map((w) => (
                        <Row key={w.id} w={w} onCancel={handleCancel} busy={busy} />
                    ))}
                </div>
            )}
        </main>
    );
};
