/**
 * Phase 6e — Admin sell-back review queue.
 *
 * High-value (≥ sell_threshold_ton) sell-back requests land here for manual
 * approval. Approve → credit user's TON balance + flip inventory row to "sold".
 * Reject → restore item to in_inventory, no balance change.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, RefreshCcw, Diamond, Inbox } from "lucide-react";
import {
    adminListSellReviews,
    adminApproveSellReview,
    adminRejectSellReview,
    adminGetRouletteConfig,
    resolveImage,
} from "@/lib/api";
import { formatTON } from "@/lib/rarity";

const STATUS_TABS = ["pending", "approved", "rejected", "all"];


export const AdminSellReviewsPage = () => {
    const { t } = useTranslation();
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({});
    const [status, setStatus] = useState("pending");
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [thresholdTon, setThresholdTon] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const data = await adminListSellReviews({ status, limit: 200 });
            setRows(data.rows || []);
            setCounts(data.counts || {});
        } catch (e) {
            toast.error(e?.response?.data?.detail || "load failed");
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => { reload(); }, [reload]);
    // Fetch threshold once for context-aware empty-state
    useEffect(() => {
        adminGetRouletteConfig()
            .then((d) => setThresholdTon(Number(d.sell_threshold_ton)))
            .catch(() => setThresholdTon(100));
    }, []);

    const approve = async (id) => {
        setBusyId(id);
        try {
            const r = await adminApproveSellReview(id, "");
            toast.success(t("sell_review.approved_toast", { credited: formatTON(r.credited_ton) }));
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "approve failed");
        } finally { setBusyId(null); }
    };

    const reject = async (id) => {
        setBusyId(id);
        try {
            await adminRejectSellReview(id, "");
            toast.success(t("sell_review.rejected_toast"));
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "reject failed");
        } finally { setBusyId(null); }
    };

    return (
        <div data-testid="admin-sell-reviews-page" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <h2 className="font-display text-lg font-black tracking-tight inline-flex items-center gap-1.5">
                    <Diamond className="w-4 h-4 text-cyber-cyan" /> {t("sell_review.title")}
                </h2>
                <button
                    onClick={reload}
                    data-testid="sell-reviews-refresh"
                    className="text-white/45 hover:text-cyber-cyan p-1.5 rounded-md hover:bg-white/5 transition"
                    aria-label={t("common.refresh")}
                >
                    <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {STATUS_TABS.map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatus(s)}
                        data-testid={`sell-reviews-tab-${s}`}
                        className={`text-[10px] font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg border whitespace-nowrap transition ${
                            status === s
                                ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                : "bg-white/5 border-white/10 text-white/55 hover:bg-white/10"
                        }`}
                    >
                        {t(`sell_review.tab_${s}`)} {counts[s] != null && <span className="opacity-60">({counts[s]})</span>}
                    </button>
                ))}
            </div>

            {rows.length === 0 ? (
                <div data-testid="sell-reviews-empty"
                     className="rounded-2xl border border-white/10 bg-cyber-surface/60 p-6 sm:p-8 text-center">
                    <Inbox className="w-8 h-8 text-white/25 mx-auto mb-2" />
                    <div className="font-display text-sm font-bold text-white/80 mb-1">
                        {loading ? t("common.loading") : t("sell_review.empty_title")}
                    </div>
                    {!loading && (
                        <p className="text-xs text-white/45 leading-relaxed max-w-sm mx-auto">
                            {t("sell_review.empty_with_threshold", {
                                threshold: thresholdTon != null ? formatTON(thresholdTon) : "—",
                            })}
                        </p>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map((r) => (
                        <div
                            key={r.id}
                            data-testid={`sell-review-row-${r.id}`}
                            className="bg-cyber-surface/60 border border-white/10 rounded-xl p-3 flex items-center gap-3"
                        >
                            {r.image_path && (
                                <img
                                    src={resolveImage(`/api/static/${r.image_path}`)}
                                    alt={r.item_name || r.item_slug}
                                    className="w-12 h-12 object-contain flex-shrink-0"
                                    draggable={false}
                                    loading="lazy"
                                />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="font-display font-bold text-sm truncate">{r.item_name || r.item_slug}</div>
                                <div className="text-[10px] text-white/55 truncate">
                                    {r.username ? `@${r.username}` : `tg${r.telegram_id}`} · {r.created_at}
                                </div>
                            </div>
                            <div className="text-right tabular-nums">
                                <div className="font-display text-base font-black text-cyber-cyan">{formatTON(r.floor_ton)}</div>
                                <div className="text-[9px] uppercase tracking-wider text-white/40">TON</div>
                            </div>
                            {r.status === "pending" && (
                                <div className="flex gap-1.5 flex-shrink-0">
                                    <button
                                        onClick={() => approve(r.id)}
                                        disabled={busyId === r.id}
                                        data-testid={`sell-review-approve-${r.id}`}
                                        className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-60"
                                        aria-label={t("sell_review.approve")}
                                    >
                                        {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    </button>
                                    <button
                                        onClick={() => reject(r.id)}
                                        disabled={busyId === r.id}
                                        data-testid={`sell-review-reject-${r.id}`}
                                        className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/35 text-rose-300 hover:bg-rose-500/25 transition disabled:opacity-60"
                                        aria-label={t("sell_review.reject")}
                                    >
                                        <XCircle className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                            {r.status !== "pending" && (
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${
                                    r.status === "approved" ? "text-emerald-300" : "text-rose-300"
                                }`}>{r.status}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminSellReviewsPage;
