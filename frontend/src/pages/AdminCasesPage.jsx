import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    Plus, Loader2, Box, Sparkles, Edit3, Power, BarChart3, Check,
    AlertTriangle, X as XIcon, RefreshCcw, Wand2,
} from "lucide-react";
import {
    adminListCases, adminGetCase, adminCreateCase, adminPatchCase,
    adminDeleteCase, adminCalibrateCase, adminCaseStats,
    adminListItems, resolveImage,
} from "@/lib/api";
import { RARITY_HEX, RARITY_LABEL, formatTON } from "@/lib/rarity";
import { DriftHeatmap } from "@/components/DriftHeatmap";

const RARITY_ORDER = ["common", "rare", "epic", "legendary", "mythic", "jackpot"];

const computeEv = (basket) => {
    const total = basket.reduce((s, b) => s + Number(b.weight || 0), 0);
    if (total <= 0) return 0;
    return basket.reduce((s, b) => s + Number(b.payout_ton || 0) * Number(b.weight || 0) / total, 0);
};

// ------ Edit Modal ------
const CaseEditor = ({ open, initial, onClose, onSaved }) => {
    const isCreate = !initial;
    const [name, setName] = useState("");
    const [id, setId] = useState("");
    const [priceTon, setPriceTon] = useState("");
    const [targetEv, setTargetEv] = useState(90);
    const [enabled, setEnabled] = useState(true);
    const [basket, setBasket] = useState([]);
    const [allItems, setAllItems] = useState([]);
    const [override, setOverride] = useState(false);
    const [busy, setBusy] = useState(false);
    const [calibration, setCalibration] = useState(null);

    useEffect(() => {
        if (!open) return;
        adminListItems({}).then(setAllItems).catch(() => {});
        if (initial) {
            setName(initial.name);
            setId(initial.id);
            setPriceTon(String(initial.price_ton));
            setTargetEv(initial.target_ev_pct ?? initial.actual_ev_pct ?? 90);
            setEnabled(initial.enabled);
            adminGetCase(initial.id).then((full) => {
                setBasket((full.basket || []).map((b) => ({
                    slug: b.slug, weight: b.weight, payout_ton: b.payout_ton,
                })));
            });
        } else {
            setName(""); setId(""); setPriceTon(""); setTargetEv(90); setEnabled(true); setBasket([]);
        }
        setCalibration(null);
        setOverride(false);
    }, [open, initial]);

    const price = Number(priceTon || 0);
    const ev = computeEv(basket);
    const evPct = price ? (ev / price * 100) : 0;
    const drift = evPct - Number(targetEv);
    const driftOk = Math.abs(drift) <= 0.5;
    const canSave = name && price > 0 && basket.length > 0 && (driftOk || override) && !busy;

    const updateRow = (i, field, val) => {
        setBasket((bk) => bk.map((b, idx) => idx === i ? { ...b, [field]: val } : b));
    };
    const addRow = (slug) => {
        if (basket.some((b) => b.slug === slug)) return;
        setBasket((bk) => [...bk, { slug, weight: 1, payout_ton: 1 }]);
    };
    const removeRow = (i) => setBasket((bk) => bk.filter((_, idx) => idx !== i));

    const handleCalibrate = async () => {
        if (!initial) {
            toast.message("Save first, then calibrate.");
            return;
        }
        setBusy(true);
        try {
            const r = await adminCalibrateCase(initial.id, Number(targetEv));
            setCalibration(r);
            if (r.feasible && r.recommended_jackpot_weight) {
                setBasket((bk) => bk.map((b) =>
                    b.slug === r.jackpot_slug ? { ...b, weight: Number(r.recommended_jackpot_weight) } : b
                ));
                toast.success("Calibrated", { description: r.message });
            } else {
                toast.warning("Cannot calibrate", { description: r.message });
            }
        } catch (e) {
            toast.error("Calibrate failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        if (!canSave) return;
        setBusy(true);
        try {
            const payload = {
                name, price_ton: price,
                target_ev_pct: Number(targetEv),
                enabled,
                basket: basket.map((b) => ({
                    slug: b.slug, weight: Number(b.weight), payout_ton: Number(b.payout_ton),
                })),
            };
            if (isCreate) {
                payload.id = id || undefined;
                await adminCreateCase(payload);
                toast.success("Case created");
            } else {
                await adminPatchCase(initial.id, payload);
                toast.success("Case saved");
            }
            onSaved?.();
            onClose?.();
        } catch (e) {
            toast.error("Save failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    if (!open) return null;
    const itemsBySlug = Object.fromEntries(allItems.map((i) => [i.slug, i]));
    const availableToAdd = allItems
        .filter((i) => !basket.some((b) => b.slug === i.slug))
        .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));

    return (
        <div onClick={onClose} className="fixed inset-0 z-[80] bg-cyber-bg/90 backdrop-blur-md flex items-start justify-center p-2 overflow-y-auto" data-testid="case-editor-backdrop">
            <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[460px] my-3 rounded-2xl bg-cyber-surface border border-cyber-cyan/30 p-4"
                data-testid="case-editor">
                <div className="flex items-center justify-between mb-2">
                    <div className="inline-flex items-center gap-1.5 text-xs uppercase font-black tracking-[0.2em] text-cyber-cyan">
                        <Box className="w-4 h-4" /> {isCreate ? "New Case" : `Edit · ${initial?.id}`}
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white p-1"><XIcon className="w-4 h-4" /></button>
                </div>

                <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} data-testid="case-edit-name"
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none mb-2" />
                {isCreate && (
                    <>
                        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">ID (slug — auto if blank)</label>
                        <input value={id} onChange={(e) => setId(e.target.value)} data-testid="case-edit-id"
                            placeholder="e.g. starter_box"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none font-mono mb-2" />
                    </>
                )}
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Price TON *</label>
                        <input type="number" value={priceTon} onChange={(e) => setPriceTon(e.target.value)} data-testid="case-edit-price"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none" />
                    </div>
                    <div>
                        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Target RTP %</label>
                        <input type="number" min={70} max={99} value={targetEv} onChange={(e) => setTargetEv(e.target.value)} data-testid="case-edit-target-ev"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none" />
                    </div>
                </div>
                <label className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/70 mb-2">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="case-edit-enabled" />
                    Enabled
                </label>

                {/* EV indicator */}
                <div className={`mt-2 rounded-lg border px-3 py-2 flex items-center justify-between ${driftOk ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-red-500/10 border-red-500/40 text-red-300"}`}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.15em]">Computed RTP</div>
                    <div className="font-mono font-black text-sm tabular-nums" data-testid="case-edit-computed-ev">{evPct.toFixed(2)}%</div>
                    <div className="text-[10px] font-mono">drift {drift >= 0 ? "+" : ""}{drift.toFixed(2)}%</div>
                </div>
                <button onClick={handleCalibrate} disabled={busy || basket.length === 0}
                    data-testid="case-edit-calibrate-btn"
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg bg-cyber-purple/15 border border-cyber-purple/40 text-cyber-purple hover:bg-cyber-purple/25 disabled:opacity-40">
                    <Wand2 className="w-3 h-3" /> Auto-calibrate jackpot weight
                </button>

                {/* Basket table */}
                <div className="mt-3">
                    <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/50 mb-1">Basket ({basket.length})</div>
                    <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto pr-1" data-testid="case-edit-basket">
                        {basket.map((b, i) => {
                            const meta = itemsBySlug[b.slug] || { name: b.slug, rarity: "common", image_url: "" };
                            const color = RARITY_HEX[meta.rarity] || RARITY_HEX.common;
                            return (
                                <div key={b.slug} className="flex items-center gap-1.5 bg-cyber-bg/60 rounded-md p-1.5 border border-white/8">
                                    {meta?.image_url
                                        ? <img src={resolveImage(meta.image_url)} alt="" className="w-7 h-7" />
                                        : <div className="w-7 h-7 rounded bg-white/8" aria-hidden="true" />}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color }}>{RARITY_LABEL[meta.rarity]}</div>
                                        <div className="font-bold text-[11px] truncate">{meta.name}</div>
                                    </div>
                                    <input type="number" step="0.01" value={b.weight} onChange={(e) => updateRow(i, "weight", Number(e.target.value))}
                                        className="w-16 bg-cyber-bg/80 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono outline-none" />
                                    <input type="number" step="0.1" value={b.payout_ton} onChange={(e) => updateRow(i, "payout_ton", Number(e.target.value))}
                                        className="w-16 bg-cyber-bg/80 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono outline-none" />
                                    <button onClick={() => removeRow(i)} className="text-white/40 hover:text-red-400 p-0.5"><XIcon className="w-3 h-3" /></button>
                                </div>
                            );
                        })}
                        {basket.length === 0 && (
                            <div className="text-[11px] text-white/40 text-center py-2">No items yet — add from below</div>
                        )}
                    </div>
                </div>

                {/* Add item dropdown */}
                <div className="mt-2">
                    <select onChange={(e) => { if (e.target.value) { addRow(e.target.value); e.target.value = ""; } }} defaultValue="" data-testid="case-edit-add-item"
                        className="w-full bg-cyber-bg/80 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none">
                        <option value="">+ Add item to basket…</option>
                        {availableToAdd.map((i) => (
                            <option key={i.slug} value={i.slug}>
                                {`[${i.rarity}] ${i.name} · ${i.slug}`}
                            </option>
                        ))}
                    </select>
                </div>

                {!driftOk && (
                    <label className="mt-3 inline-flex items-center gap-2 text-[10px] text-amber-300/90">
                        <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="case-edit-override" />
                        <AlertTriangle className="w-3 h-3" /> I know what I'm doing (RTP drift &gt;0.5%)
                    </label>
                )}

                <div className="flex gap-2 mt-4">
                    <button onClick={onClose} className="flex-1 text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg py-2.5">Cancel</button>
                    <button onClick={handleSave} disabled={!canSave} data-testid="case-edit-save-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-2.5 disabled:opacity-40 bg-gradient-to-r from-cyber-cyan to-emerald-400 text-cyber-bg">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {isCreate ? "Create" : "Save"}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

// ------ Main page ------
export const AdminCasesPage = () => {
    const [cases, setCases] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState({ open: false, initial: null });

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const list = await adminListCases();
            setCases(list);
            const ss = await Promise.all(list.map((c) => adminCaseStats(c.id).catch(() => null)));
            const m = {};
            list.forEach((c, i) => { if (ss[i]) m[c.id] = ss[i]; });
            setStats(m);
        } catch (e) {
            toast.error("Failed to load cases", { description: e?.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const handleToggle = async (c) => {
        try {
            if (c.enabled) {
                await adminDeleteCase(c.id);
                toast.success(`Disabled ${c.name}`);
            } else {
                await adminPatchCase(c.id, { enabled: true });
                toast.success(`Enabled ${c.name}`);
            }
            await reload();
        } catch (e) {
            toast.error("Toggle failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    return (
        <div data-testid="admin-cases-page">
            {/* Phase 4a — Drift heatmap (top of page) */}
            <div className="mb-3 rounded-xl border border-white/10 bg-cyber-surface/60 p-2.5">
                <DriftHeatmap onTileClick={(caseId) => {
                    const c = cases.find((x) => x.id === caseId);
                    if (c) setEditor({ open: true, initial: c });
                }} refreshKey={cases.length} />
            </div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] text-white/60 inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyber-cyan" />
                    {cases.length} case{cases.length === 1 ? "" : "s"}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={reload} className="text-white/40 hover:text-cyber-cyan p-1" data-testid="admin-cases-refresh"><RefreshCcw className="w-4 h-4" /></button>
                    <button onClick={() => setEditor({ open: true, initial: null })} data-testid="admin-cases-new-btn"
                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg hover:brightness-110">
                        <Plus className="w-3 h-3" /> New
                    </button>
                </div>
            </div>
            {loading ? (
                <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : (
                <div className="flex flex-col gap-2" data-testid="admin-cases-list">
                    {cases.map((c) => {
                        const s = stats[c.id] || {};
                        const drift = s.drift_pct ?? 0;
                        const driftAbsBig = Math.abs(drift) > 5;
                        return (
                            <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                className={`rounded-xl border p-3 ${c.enabled ? "bg-cyber-surface border-white/10" : "bg-cyber-surface/40 border-white/5 opacity-60"}`}
                                data-testid={`admin-case-row-${c.id}`}>
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 rounded-lg bg-cyber-bg flex items-center justify-center border border-cyber-cyan/15">
                                        {c.image_url
                                            ? <img src={resolveImage(c.image_url)} alt="" className="w-9 h-9 object-contain" />
                                            : <div className="w-9 h-9 rounded bg-white/8" aria-hidden="true" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-1">
                                            <div className="min-w-0">
                                                <div className="font-bold text-sm truncate">{c.name}</div>
                                                <div className="text-[10px] text-white/45 font-mono">{c.id} · {c.item_count} items · {formatTON(c.price_ton)} TON</div>
                                            </div>
                                            {!c.enabled && (
                                                <span className="text-[8.5px] font-black uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-md border border-white/15 text-white/55">DISABLED</span>
                                            )}
                                        </div>
                                        <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                                            <div>
                                                <div className="text-white/40">Target</div>
                                                <div className="font-mono font-bold">{c.actual_ev_pct}%</div>
                                            </div>
                                            <div>
                                                <div className="text-white/40">Realized</div>
                                                <div className="font-mono font-bold">{s.realized_rtp_pct ?? "—"}%</div>
                                            </div>
                                            <div>
                                                <div className="text-white/40">Drift</div>
                                                <div className={`font-mono font-bold ${driftAbsBig ? "text-red-300" : "text-emerald-300"}`}>
                                                    {drift >= 0 ? "+" : ""}{(s.drift_pct ?? 0).toFixed(2)}%
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-1 text-[10px] text-white/45 inline-flex items-center gap-1"><BarChart3 className="w-2.5 h-2.5" /> {s.total_opens ?? 0} opens</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/8">
                                    <button onClick={() => setEditor({ open: true, initial: c })}
                                        data-testid={`admin-case-edit-${c.id}`}
                                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/20">
                                        <Edit3 className="w-2.5 h-2.5" /> Edit
                                    </button>
                                    <button onClick={() => handleToggle(c)}
                                        data-testid={`admin-case-toggle-${c.id}`}
                                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-white/70 hover:bg-white/10">
                                        <Power className="w-2.5 h-2.5" /> {c.enabled ? "Disable" : "Enable"}
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            <CaseEditor open={editor.open} initial={editor.initial}
                onClose={() => setEditor({ open: false, initial: null })}
                onSaved={reload} />
        </div>
    );
};

export default AdminCasesPage;
