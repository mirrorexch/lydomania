import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    RefreshCcw, ExternalLink, Loader2, CheckCircle2, XCircle, Clock,
    Hourglass, X as XIcon, Diamond, Copy, ArrowUpRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchMyWithdrawals, cancelMyWithdrawal, resolveImage } from "@/lib/api";
import { RARITY_HEX, formatTON } from "@/lib/rarity";
import { confirmAsync } from "@/components/common/confirmDialog";

const STATUS_META_ICON = {
    pending: { icon: Hourglass, color: "#fbbf24" },
    processing: { icon: Loader2, color: "#FFD700", spin: true },
    fulfilled: { icon: CheckCircle2, color: "#34d399" },
    rejected: { icon: XCircle, color: "#f87171" },
    cancelled: { icon: XIcon, color: "#9ca3af" },
};

const useFmtRelative = () => {
    const { t } = useTranslation();
    return (iso) => {
        if (!iso) return "—";
        const ts = new Date(iso).getTime();
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return t("withdrawals.just_now");
        if (diff < 3600) return t("withdrawals.minutes_ago", { n: Math.floor(diff / 60) });
        if (diff < 86400) return t("withdrawals.hours_ago", { n: Math.floor(diff / 3600) });
        return t("withdrawals.days_ago", { n: Math.floor(diff / 86400) });
    };
};

const StatusChip = ({ status }) => {
    const { t } = useTranslation();
    const m = STATUS_META_ICON[status] || STATUS_META_ICON.pending;
    const Icon = m.icon;
    return (
        <span
            className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md border"
            style={{ color: m.color, background: `${m.color}15`, borderColor: `${m.color}55` }}
        >
            <Icon className={`w-2.5 h-2.5 ${m.spin ? "animate-spin" : ""}`} />
            {t(`withdrawals.status_${status}`, { defaultValue: status.toUpperCase() })}
        </span>
    );
};

const Row = ({ w, onCancel, busy }) => {
    const { t } = useTranslation();
    const fmtRelative = useFmtRelative();
    const color = RARITY_HEX[w.item_rarity] || RARITY_HEX.common;
    const copyAddress = () => {
        navigator.clipboard?.writeText(w.destination_address);
        toast.success(t("withdrawals.address_copied"));
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
                                {t(`rarity.${w.item_rarity}`)}
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
                            <ExternalLink className="w-2.5 h-2.5" /> {t("withdrawals.view_tx")}
                        </a>
                    )}
                    {w.status === "pending" && (
                        <button
                            onClick={() => onCancel?.(w)}
                            disabled={busy}
                            data-testid={`withdrawal-cancel-${w.id}`}
                            className="text-[10px] font-bold text-white/60 hover:text-red-400 px-2 py-1 rounded-md bg-white/5 border border-white/10 disabled:opacity-40"
                        >
                            {t("withdrawals.cancel")}
                        </button>
                    )}
                    {w.status === "rejected" && w.rejection_reason && (
                        <span className="text-[10px] text-red-300/80 italic truncate max-w-[180px]" title={w.rejection_reason}>
                            "{w.rejection_reason}"
                        </span>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export const WithdrawalsPage = () => {
    const { t } = useTranslation();
    const [items, setItems] = useState([]);
    const [status, setStatus] = useState("all");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);

    const STATUS_TABS = [
        { value: "all", label: t("withdrawals.tab_all") },
        { value: "pending", label: t("withdrawals.tab_pending") },
        { value: "processing", label: t("withdrawals.tab_processing") },
        { value: "fulfilled", label: t("withdrawals.tab_delivered") },
        { value: "rejected", label: t("withdrawals.tab_rejected") },
        { value: "cancelled", label: t("withdrawals.tab_cancelled") },
    ];

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetchMyWithdrawals(status);
            setItems(r);
        } catch (e) {
            toast.error(t("withdrawals.load_failed"), { description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [status, t]);

    useEffect(() => { reload(); }, [reload]);

    const handleCancel = async (w) => {
        if (busy) return;
        if (!(await confirmAsync({
            title: t("withdrawals.cancel_confirm", { item: w.item_name }),
            confirmLabel: t("withdrawals.cancel_btn"),
            destructive: true,
        }))) return;
        setBusy(true);
        try {
            await cancelMyWithdrawal(w.id);
            toast.success(t("withdrawals.cancel_success"));
            await reload();
        } catch (e) {
            toast.error(t("withdrawals.cancel_failed"), { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="mx-auto px-4 sm:px-6 pt-3 pb-24 lg:pb-6
            max-w-[430px] sm:max-w-[640px] lg:max-w-[760px]" data-testid="withdrawals-page">
            <div className="flex items-baseline justify-between mb-3">
                <div>
                    <h1 className="font-display text-2xl font-black tracking-tight inline-flex items-center gap-2">
                        {t("withdrawals.title")}
                        <ArrowUpRight className="w-5 h-5 text-cyber-cyan" />
                    </h1>
                    <div className="text-[11px] text-white/45 mt-0.5">
                        {t("withdrawals.subtitle")}
                    </div>
                </div>
                <button
                    onClick={reload}
                    data-testid="withdrawals-refresh-btn"
                    className="text-white/40 hover:text-cyber-cyan transition p-1"
                    aria-label={t("collection.refresh_aria")}
                >
                    <RefreshCcw className="w-4 h-4" />
                </button>
            </div>

            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {STATUS_TABS.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setStatus(tab.value)}
                        data-testid={`withdrawals-tab-${tab.value}`}
                        className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border whitespace-nowrap transition ${
                            status === tab.value
                                ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16 text-white/40">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-cyber-surface/40 p-8 text-center">
                    <div className="text-sm text-white/50">{t("withdrawals.empty_title")}</div>
                    <div className="text-xs text-white/35 mt-1">
                        {t("withdrawals.empty_subtitle")}
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
