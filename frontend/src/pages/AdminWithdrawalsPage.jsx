import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
    Shield, RefreshCcw, Search, ExternalLink, X as XIcon, Loader2,
    Play, CheckCircle2, XCircle, Copy, Clock, Diamond, ChevronRight,
    Hourglass, AlertTriangle, BarChart3, Activity,
} from "lucide-react";
import {
    adminListWithdrawals,
    adminStartWithdrawal,
    adminFulfillWithdrawal,
    adminRejectWithdrawal,
    adminWithdrawalStats,
    fetchFloorPrices,
    resolveImage,
} from "@/lib/api";
import { RARITY_HEX, RARITY_LABEL, formatTON } from "@/lib/rarity";

const STATUS_TABS = [
    { value: "pending", label: "Pending" },
    { value: "processing", label: "Processing" },
    { value: "fulfilled", label: "Delivered" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
];

const STATUS_META = {
    pending: { color: "#fbbf24", label: "PENDING" },
    processing: { color: "#22d3ee", label: "PROCESSING" },
    fulfilled: { color: "#34d399", label: "DELIVERED" },
    rejected: { color: "#f87171", label: "REJECTED" },
    cancelled: { color: "#9ca3af", label: "CANCELLED" },
};

const fmtSince = (iso) => {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
};

const fmtDuration = (secs) => {
    if (!secs && secs !== 0) return "—";
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    return `${(secs / 3600).toFixed(1)}h`;
};

const StatTile = ({ label, value, sub, accent }) => (
    <div className="rounded-xl border border-white/10 bg-cyber-surface/70 p-3">
        <div className="text-[9px] uppercase font-bold tracking-[0.2em] text-white/45">{label}</div>
        <div className="font-display text-xl font-black mt-0.5 tabular-nums" style={{ color: accent || "#fff" }}>
            {value}
        </div>
        {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
);

const truncAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : "—");

// Helper: map our item slug to fragment.com gift collection slug
const FRAGMENT_OVERRIDES = { durov_cap: "durovscap", westside_sign: "westsidesign", tama_gadget: "tamagadget" };
const fragmentSlug = (slug) => FRAGMENT_OVERRIDES[slug] || (slug || "").replace(/_/g, "").toLowerCase();
const fragmentUrl = (slug) => `https://fragment.com/gifts/${fragmentSlug(slug)}?sort=price_asc&filter=sale`;
// Portal market (web) — used as a secondary buy-source link for the admin
const portalsMarketUrl = (slug) =>
    `https://t.me/portals?startapp=gift_${fragmentSlug(slug)}_sort_price`;

// ---------- Fulfill Modal ----------
const FulfillModal = ({ withdrawal, open, onClose, onDone }) => {
    const [tx, setTx] = useState("");
    const [val, setVal] = useState("");
    const [src, setSrc] = useState("portal");
    const [variant, setVariant] = useState("");
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    const [floor, setFloor] = useState(null);

    useEffect(() => {
        if (open) {
            setTx("");
            setVal(String(withdrawal?.payout_ton ?? ""));
            setSrc("portal");
            setVariant("");
            setNotes("");
        }
    }, [open, withdrawal]);

    useEffect(() => {
        if (!open || !withdrawal?.item_slug) {
            setFloor(null);
            return;
        }
        let cancelled = false;
        fetchFloorPrices(withdrawal.item_slug)
            .then((d) => { if (!cancelled) setFloor(d || null); })
            .catch(() => { if (!cancelled) setFloor(null); });
        return () => { cancelled = true; };
    }, [open, withdrawal?.item_slug]);

    if (!open || !withdrawal) return null;
    const txValid = tx.trim().length >= 4;

    const handleSubmit = async () => {
        if (!txValid || busy) return;
        setBusy(true);
        try {
            await adminFulfillWithdrawal(withdrawal.id, {
                tx_hash: tx.trim(),
                fulfillment_value_ton: val ? Number(val) : null,
                gift_source: src,
                purchased_variant_info: variant || null,
                admin_notes: notes || null,
            });
            toast.success("Withdrawal fulfilled", { description: `${withdrawal.item_name} delivered` });
            onDone?.();
            onClose?.();
        } catch (e) {
            toast.error("Fulfill failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    const previewLink = txValid ? `https://tonviewer.com/transaction/${tx.trim()}` : null;
    const frag = fragmentUrl(withdrawal.item_slug);
    const portal = portalsMarketUrl(withdrawal.item_slug);

    return (
        <div
            onClick={onClose}
            data-testid="fulfill-modal-backdrop"
            className="fixed inset-0 z-[70] bg-cyber-bg/85 backdrop-blur-md flex items-end sm:items-center justify-center p-3 overflow-y-auto"
        >
            <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                data-testid="fulfill-modal"
                className="w-full max-w-[460px] my-4 rounded-2xl bg-cyber-surface border border-cyber-cyan/30 p-4"
                style={{ boxShadow: "0 0 60px rgba(34, 211, 238, 0.15)" }}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="inline-flex items-center gap-1.5 text-xs uppercase font-black tracking-[0.2em] text-cyber-cyan">
                        <CheckCircle2 className="w-4 h-4" /> Mark Fulfilled · Buy Floor
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white p-1">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Action context */}
                <div className="rounded-lg bg-cyber-bg/60 border border-white/10 p-2.5 text-[11px] text-white/65 leading-snug mb-3">
                    <div className="font-bold text-white/85 mb-0.5">Operation:</div>
                    Purchase the <b className="text-white">cheapest {withdrawal.item_name}</b> from the gift market (any backdrop / model) and send to <code className="text-cyber-cyan">{truncAddr(withdrawal.destination_address)}</code>.
                </div>

                {/* Marketplace shortcut buttons */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                    <a
                        href={frag}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="fulfill-fragment-link"
                        className="inline-flex items-center justify-center gap-1 text-[10.5px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-cyber-cyan/10 border border-cyber-cyan/40 text-cyber-cyan hover:bg-cyber-cyan/20 transition"
                    >
                        <ExternalLink className="w-3 h-3" /> Open on Fragment
                    </a>
                    <a
                        href={portal}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="fulfill-portal-link"
                        className="inline-flex items-center justify-center gap-1 text-[10.5px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-cyber-purple/10 border border-cyber-purple/40 text-cyber-purple hover:bg-cyber-purple/20 transition"
                    >
                        <ExternalLink className="w-3 h-3" /> Open on Portals
                    </a>
                </div>

                {/* Live floor + drift indicator (Phase 3b) */}
                {floor && floor.floor_ton ? (() => {
                    const liveFloor = floor.floor_ton;
                    const payout = withdrawal.payout_ton;
                    const driftPct = ((liveFloor - payout) / payout) * 100;
                    const losing = liveFloor > payout;
                    const close = !losing && driftPct > -10;  // floor close to payout — slim margin
                    const tone = losing
                        ? "bg-red-500/15 border-red-500/50 text-red-200"
                        : close
                            ? "bg-amber-500/15 border-amber-500/50 text-amber-200"
                            : "bg-emerald-500/15 border-emerald-500/50 text-emerald-200";
                    return (
                        <div className={`mb-3 rounded-lg border px-3 py-2 ${tone}`} data-testid="fulfill-floor-drift">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] inline-flex items-center gap-1">
                                    <Activity className="w-3 h-3" /> Live floor
                                </div>
                                <div className="text-[11px] font-mono font-bold">
                                    {liveFloor.toFixed(2)} TON
                                </div>
                            </div>
                            <div className="flex items-center justify-between mt-1 text-[10.5px]">
                                <div>
                                    Payout: <span className="font-mono font-bold">{payout.toFixed(2)} TON</span>
                                </div>
                                <div className={`font-mono font-bold ${losing ? "text-red-200" : "text-current"}`}>
                                    {losing ? "💸 over by " : "margin "}
                                    {driftPct >= 0 ? "+" : ""}{driftPct.toFixed(1)}%
                                </div>
                            </div>
                            {losing && (
                                <div className="text-[10px] mt-1 opacity-90">
                                    ⚠️ Floor exceeds payout — fulfilling this loses TON.
                                </div>
                            )}
                        </div>
                    );
                })() : null}

                <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50">
                    TX Hash (after sending NFT) <span className="text-red-400">*</span>
                </label>
                <input
                    data-testid="fulfill-tx-input"
                    value={tx}
                    onChange={(e) => setTx(e.target.value)}
                    placeholder="abc123def456..."
                    className="mt-1 mb-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none"
                />
                {previewLink && (
                    <a
                        href={previewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-cyber-cyan/80 hover:text-cyber-purple"
                    >
                        <ExternalLink className="w-2.5 h-2.5" /> Preview on TonViewer
                    </a>
                )}

                <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50 block mt-3">
                    Variant info (which NFT did you actually buy?)
                </label>
                <input
                    data-testid="fulfill-variant-input"
                    value={variant}
                    onChange={(e) => setVariant(e.target.value)}
                    placeholder="e.g. Plush Pepe #4729 · Black Hole backdrop"
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none"
                />
                <div className="text-[9.5px] text-white/35 mt-0.5">
                    Shown to the user in the delivery DM. Leave blank → "cheapest available".
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                    <div>
                        <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50">
                            Paid (TON)
                        </label>
                        <input
                            data-testid="fulfill-value-input"
                            value={val}
                            onChange={(e) => setVal(e.target.value)}
                            placeholder="floor price"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50">
                            Bought from
                        </label>
                        <select
                            data-testid="fulfill-source-select"
                            value={src}
                            onChange={(e) => setSrc(e.target.value)}
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-bold outline-none"
                        >
                            <option value="portal">Portal</option>
                            <option value="mrkt">MRKT</option>
                            <option value="fragment">Fragment</option>
                            <option value="manual">Manual</option>
                        </select>
                    </div>
                </div>

                <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50 block mt-3">
                    Admin Notes (internal)
                </label>
                <textarea
                    data-testid="fulfill-notes-input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="internal notes…"
                    rows={2}
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none resize-none"
                />

                <div className="flex gap-2 mt-4">
                    <button
                        onClick={onClose}
                        className="flex-1 text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg py-2.5"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!txValid || busy}
                        data-testid="fulfill-submit-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-2.5 disabled:opacity-40 bg-gradient-to-r from-cyber-cyan to-emerald-400 text-cyber-bg"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Confirm Delivery
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

// ---------- Reject Modal ----------
const RejectModal = ({ withdrawal, open, onClose, onDone }) => {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => { if (open) setReason(""); }, [open]);

    if (!open || !withdrawal) return null;
    const valid = reason.trim().length >= 10;

    const handleSubmit = async () => {
        if (!valid || busy) return;
        setBusy(true);
        try {
            await adminRejectWithdrawal(withdrawal.id, reason.trim());
            toast.success("Withdrawal rejected", { description: "Item returned to user's inventory" });
            onDone?.();
            onClose?.();
        } catch (e) {
            toast.error("Reject failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            onClick={onClose}
            data-testid="reject-modal-backdrop"
            className="fixed inset-0 z-[70] bg-cyber-bg/85 backdrop-blur-md flex items-end sm:items-center justify-center p-3"
        >
            <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                data-testid="reject-modal"
                className="w-full max-w-[460px] rounded-2xl bg-cyber-surface border border-red-500/30 p-4"
                style={{ boxShadow: "0 0 60px rgba(248, 113, 113, 0.15)" }}
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="inline-flex items-center gap-1.5 text-xs uppercase font-black tracking-[0.2em] text-red-400">
                        <AlertTriangle className="w-4 h-4" /> Reject Withdrawal
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white p-1">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
                <div className="text-[11px] text-white/55 mb-3">
                    Rejecting <b className="text-white">{withdrawal.item_name}</b> ({formatTON(withdrawal.payout_ton)} TON).
                    The user will be notified and the item will return to their inventory.
                </div>
                <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50">
                    Reason <span className="text-red-400">*</span> (min 10 chars)
                </label>
                <textarea
                    data-testid="reject-reason-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. item out of stock on Portal — try again later"
                    rows={3}
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-red-400 rounded-lg px-3 py-2 text-xs outline-none resize-none"
                />
                <div className="text-[10px] text-white/40 mt-1">{reason.length} chars</div>

                <div className="flex gap-2 mt-4">
                    <button
                        onClick={onClose}
                        className="flex-1 text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg py-2.5"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!valid || busy}
                        data-testid="reject-submit-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-2.5 disabled:opacity-40 bg-gradient-to-r from-red-500 to-orange-500 text-white"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        Reject
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

// ---------- Row ----------
const AdminRow = ({ w, busy, onStart, onFulfill, onReject }) => {
    const color = RARITY_HEX[w.item_rarity] || RARITY_HEX.common;
    const meta = STATUS_META[w.status] || STATUS_META.pending;
    const tonscan = w.fulfillment_tx_hash ? `https://tonviewer.com/transaction/${w.fulfillment_tx_hash}` : null;
    const copyAddr = () => {
        navigator.clipboard?.writeText(w.destination_address);
        toast.success("Address copied");
    };
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid={`admin-withdrawal-row-${w.id}`}
            className="rounded-xl bg-cyber-surface border border-white/10 p-3 hover:border-white/20 transition"
            style={{ boxShadow: `inset 0 0 10px ${color}11` }}
        >
            <div className="flex items-start gap-3">
                <div
                    className="w-12 h-12 rounded-lg bg-cyber-bg flex items-center justify-center flex-shrink-0"
                    style={{ boxShadow: `inset 0 0 12px ${color}33`, border: `1px solid ${color}44` }}
                >
                    <img src={resolveImage(w.item_image_url)} alt="" className="w-9 h-9 object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color }}>
                                {RARITY_LABEL[w.item_rarity]} · {formatTON(w.payout_ton)} TON
                            </div>
                            <div className="font-bold text-sm truncate">{w.item_name}</div>
                            <div className="text-[10px] text-white/45 truncate">
                                <span className="font-mono text-white/70">@{w.user.username || w.user.first_name || "anon"}</span>
                                <span className="mx-1 text-white/30">·</span>
                                <span className="font-mono">tg:{w.user.telegram_id}</span>
                            </div>
                        </div>
                        <span
                            className="text-[8.5px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md border whitespace-nowrap"
                            style={{ color: meta.color, background: `${meta.color}15`, borderColor: `${meta.color}55` }}
                        >
                            {meta.label}
                        </span>
                    </div>
                    {/* Address row */}
                    <button
                        onClick={copyAddr}
                        className="flex items-center gap-1 mt-1.5 text-[10px] text-white/45 hover:text-white/80 transition"
                    >
                        <Copy className="w-2.5 h-2.5" />
                        <span className="font-mono">{truncAddr(w.destination_address)}</span>
                    </button>
                </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/8">
                <div className="text-[10px] text-white/40 inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {fmtSince(w.requested_at)} ago
                </div>
                <div className="flex items-center gap-1.5">
                    {w.status === "pending" && (
                        <>
                            <button
                                onClick={() => onStart(w)}
                                disabled={busy === w.id}
                                data-testid={`admin-start-${w.id}`}
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md bg-cyber-cyan/15 border border-cyber-cyan/40 text-cyber-cyan hover:bg-cyber-cyan/25 disabled:opacity-40"
                            >
                                <Play className="w-2.5 h-2.5" /> Start
                            </button>
                            <button
                                onClick={() => onReject(w)}
                                disabled={busy === w.id}
                                data-testid={`admin-reject-${w.id}`}
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                            >
                                <XCircle className="w-2.5 h-2.5" /> Reject
                            </button>
                        </>
                    )}
                    {w.status === "processing" && (
                        <>
                            <button
                                onClick={() => onFulfill(w)}
                                disabled={busy === w.id}
                                data-testid={`admin-fulfill-${w.id}`}
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                            >
                                <CheckCircle2 className="w-2.5 h-2.5" /> Fulfilled
                            </button>
                            <button
                                onClick={() => onReject(w)}
                                disabled={busy === w.id}
                                data-testid={`admin-reject-${w.id}`}
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                            >
                                <XCircle className="w-2.5 h-2.5" /> Reject
                            </button>
                        </>
                    )}
                    {w.status === "fulfilled" && tonscan && (
                        <a
                            href={tonscan}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-cyber-cyan hover:text-cyber-purple px-2 py-1 rounded-md bg-white/5 border border-white/10"
                        >
                            <ExternalLink className="w-2.5 h-2.5" /> TX
                        </a>
                    )}
                    {w.status === "rejected" && w.rejection_reason && (
                        <span className="text-[10px] text-red-300/80 italic truncate max-w-[200px]" title={w.rejection_reason}>
                            “{w.rejection_reason}”
                        </span>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

// ---------- Main page ----------
export const AdminWithdrawalsPage = () => {
    const [status, setStatus] = useState("pending");
    const [search, setSearch] = useState("");
    const [items, setItems] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(null);
    const [fulfilling, setFulfilling] = useState(null);
    const [rejecting, setRejecting] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [list, s] = await Promise.all([
                adminListWithdrawals({ status, search, sort: "requested_desc", limit: 100 }),
                adminWithdrawalStats(),
            ]);
            setItems(list);
            setStats(s);
        } catch (e) {
            toast.error("Admin load failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setLoading(false);
        }
    }, [status, search]);

    useEffect(() => { reload(); }, [reload]);

    const handleStart = async (w) => {
        if (busy) return;
        setBusy(w.id);
        try {
            await adminStartWithdrawal(w.id);
            toast.success("Marked as processing", { description: w.item_name });
            await reload();
        } catch (e) {
            toast.error("Start failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(null);
        }
    };

    return (
        <main className="max-w-[430px] mx-auto px-4 pt-3 pb-24" data-testid="admin-withdrawals-page">
            {/* Title */}
            <div className="flex items-baseline justify-between mb-3">
                <div>
                    <h1 className="font-display text-2xl font-black tracking-tight inline-flex items-center gap-2">
                        <Shield className="w-5 h-5 text-cyber-cyan" />
                        Admin · Queue
                    </h1>
                    <div className="text-[11px] text-white/45 mt-0.5">
                        NFT-gift withdrawal management
                    </div>
                </div>
                <button
                    onClick={reload}
                    data-testid="admin-refresh-btn"
                    className="text-white/40 hover:text-cyber-cyan p-1 transition"
                >
                    <RefreshCcw className="w-4 h-4" />
                </button>
            </div>

            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-2 mb-3" data-testid="admin-stats">
                <StatTile
                    label="Pending"
                    value={stats?.pending_count ?? "—"}
                    accent="#fbbf24"
                    sub={<><Hourglass className="w-2.5 h-2.5 inline" /> in queue</>}
                />
                <StatTile
                    label="Processing"
                    value={stats?.processing_count ?? "—"}
                    accent="#22d3ee"
                    sub="in flight"
                />
                <StatTile
                    label="Value Pending"
                    value={formatTON(stats?.total_value_pending_ton ?? 0)}
                    sub="TON outstanding"
                />
                <StatTile
                    label="Avg Fulfill"
                    value={fmtDuration(stats?.avg_fulfillment_seconds)}
                    sub={<><BarChart3 className="w-2.5 h-2.5 inline" /> historic</>}
                />
            </div>

            {/* Search */}
            <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                    data-testid="admin-search-input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by id / @username / telegram_id"
                    className="w-full bg-cyber-surface border border-white/10 focus:border-cyber-cyan/40 rounded-lg pl-9 pr-3 py-2 text-xs outline-none"
                />
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {STATUS_TABS.map((t) => {
                    const cnt = stats?.[`${t.value}_count`];
                    return (
                        <button
                            key={t.value}
                            onClick={() => setStatus(t.value)}
                            data-testid={`admin-tab-${t.value}`}
                            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border whitespace-nowrap transition inline-flex items-center gap-1 ${
                                status === t.value
                                    ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                            }`}
                        >
                            {t.label}
                            {cnt > 0 && t.value !== "all" && (
                                <span className={status === t.value ? "text-cyber-cyan/80" : "text-white/40"}>
                                    {cnt}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* List */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-white/40">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-cyber-surface/40 p-8 text-center">
                    <div className="text-2xl mb-2">🛡️</div>
                    <div className="text-sm text-white/50">No withdrawals match.</div>
                </div>
            ) : (
                <div className="flex flex-col gap-2" data-testid="admin-withdrawals-list">
                    {items.map((w) => (
                        <AdminRow
                            key={w.id}
                            w={w}
                            busy={busy}
                            onStart={handleStart}
                            onFulfill={(x) => setFulfilling(x)}
                            onReject={(x) => setRejecting(x)}
                        />
                    ))}
                </div>
            )}

            {/* Modals */}
            <AnimatePresence>
                {fulfilling && (
                    <FulfillModal
                        withdrawal={fulfilling}
                        open={!!fulfilling}
                        onClose={() => setFulfilling(null)}
                        onDone={reload}
                    />
                )}
                {rejecting && (
                    <RejectModal
                        withdrawal={rejecting}
                        open={!!rejecting}
                        onClose={() => setRejecting(null)}
                        onDone={reload}
                    />
                )}
            </AnimatePresence>
        </main>
    );
};

export default AdminWithdrawalsPage;
