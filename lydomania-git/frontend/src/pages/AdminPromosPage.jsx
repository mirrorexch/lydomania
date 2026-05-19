/**
 * Phase 4b — Admin Promos page: CRUD + redemption analytics.
 */
import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2, Ticket, Trash2, Eye, X as XIcon, Check, Sparkles, Edit3 } from "lucide-react";
import { toast } from "sonner";
import {
    adminListPromos, adminCreatePromo, adminGetPromo, adminPatchPromo, adminDeletePromo,
} from "@/lib/api";
import { confirmAsync } from "@/components/common/confirmDialog";

const TYPES = [
    { key: "ton_bonus", label: "TON Bonus", unit: "TON", placeholder: "5.0" },
    { key: "free_spin_token", label: "Free Spin Token", unit: "tokens", placeholder: "1" },
];

function PromoForm({ initial, onSave, onCancel }) {
    const [code, setCode] = useState(initial?.code || "");
    const [type, setType] = useState(initial?.type || "ton_bonus");
    const [value, setValue] = useState(initial?.value ?? 1);
    const [maxRedemptions, setMaxRedemptions] = useState(initial?.max_redemptions ?? 0);
    const [userMax, setUserMax] = useState(initial?.user_max ?? 1);
    const [expiresAt, setExpiresAt] = useState(initial?.expires_at?.slice(0, 16) || "");
    const [notes, setNotes] = useState(initial?.notes || "");
    const [busy, setBusy] = useState(false);
    const editing = !!initial;

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const payload = {
                code: code.trim().toUpperCase(),
                type, value: Number(value),
                max_redemptions: Number(maxRedemptions) || 0,
                user_max: Number(userMax) || 1,
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
                notes: notes || null,
            };
            const saved = editing
                ? await adminPatchPromo(initial.code, payload)
                : await adminCreatePromo(payload);
            toast.success(editing ? "Promo updated" : "Promo created", { description: saved.code });
            onSave(saved);
        } catch (err) {
            toast.error("Save failed", { description: err?.response?.data?.detail || err?.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <motion.form
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
            onSubmit={submit} className="rounded-xl border border-emerald-500/30 bg-cyber-surface/70 p-3 space-y-2.5"
            data-testid="promo-form"
        >
            <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">Code</span>
                    <input
                        type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                        disabled={editing} maxLength={32} minLength={3} required
                        autoCapitalize="characters" spellCheck="false"
                        data-testid="promo-form-code"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] font-mono uppercase tracking-wider text-white disabled:opacity-50"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">Type</span>
                    <select
                        value={type} onChange={(e) => setType(e.target.value)} disabled={editing}
                        data-testid="promo-form-type"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white disabled:opacity-50"
                    >
                        {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">
                        Value ({(TYPES.find((t) => t.key === type) || TYPES[0]).unit})
                    </span>
                    <input
                        type="number" min="0.001" step={type === "free_spin_token" ? "1" : "0.01"}
                        value={value} onChange={(e) => setValue(e.target.value)} required
                        data-testid="promo-form-value"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] font-mono text-white"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">Max redemptions (0=∞)</span>
                    <input
                        type="number" min="0" step="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)}
                        data-testid="promo-form-max-redemptions"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] font-mono text-white"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">User max</span>
                    <input
                        type="number" min="1" max="100" step="1" value={userMax} onChange={(e) => setUserMax(e.target.value)}
                        data-testid="promo-form-user-max"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] font-mono text-white"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">Expires (optional)</span>
                    <input
                        type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                        data-testid="promo-form-expires-at"
                        className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[11.5px] text-white"
                    />
                </label>
            </div>
            <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-white/45 font-bold">Notes</span>
                <input
                    type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500}
                    data-testid="promo-form-notes"
                    className="w-full bg-cyber-bg border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white"
                />
            </label>
            <div className="flex items-center gap-1.5 justify-end pt-1">
                <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md text-white/60 hover:text-white/85 hover:bg-white/5">
                    <XIcon className="w-3 h-3" /> Cancel
                </button>
                <button type="submit" disabled={busy} data-testid="promo-form-submit"
                    className="inline-flex items-center gap-1 text-[10.5px] font-black uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40">
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    {editing ? "Save" : "Create"}
                </button>
            </div>
        </motion.form>
    );
}

export const AdminPromosPage = () => {
    const [rows, setRows] = useState([]);
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(null);
    const [details, setDetails] = useState(null);

    const load = useCallback(async () => {
        setBusy(true);
        try {
            const r = await adminListPromos({ includeDisabled: true });
            setRows(r);
        } catch (e) {
            toast.error("Load failed", { description: e?.response?.data?.detail || e?.message });
        } finally { setBusy(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const onDelete = async (code) => {
        if (!(await confirmAsync({
            title: "Disable promo?",
            description: `${code} · Existing redemptions are kept.`,
            confirmLabel: "Disable",
            destructive: true,
        }))) return;
        try {
            await adminDeletePromo(code);
            toast.success("Promo disabled", { description: code });
            load();
        } catch (e) {
            toast.error("Delete failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    const onShowDetails = async (code) => {
        try {
            const d = await adminGetPromo(code);
            setDetails(d);
        } catch (e) {
            toast.error("Load failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    return (
        <div data-testid="admin-promos-page" className="pb-24">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-emerald-300" />
                    <h2 className="text-base font-black uppercase tracking-wider text-white/90">Promo Codes</h2>
                </div>
                {!creating && !editing && (
                    <button onClick={() => setCreating(true)} data-testid="promo-create-btn"
                        className="inline-flex items-center gap-1 text-[10.5px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25">
                        <Plus className="w-3 h-3" /> New
                    </button>
                )}
            </div>

            {creating && <div className="mb-3"><PromoForm onSave={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} /></div>}
            {editing && <div className="mb-3"><PromoForm initial={editing} onSave={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /></div>}

            {busy && !rows.length && <div className="flex items-center justify-center py-12 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            {!busy && rows.length === 0 && (
                <div className="text-center py-12 text-white/40 text-[12px]">No promo codes yet — create one above.</div>
            )}

            <div className="space-y-1.5">
                {rows.map((r) => {
                    const fullyRedeemed = r.max_redemptions > 0 && r.current_redemptions >= r.max_redemptions;
                    const expired = r.expires_at && new Date(r.expires_at).getTime() < Date.now();
                    const inactive = !r.enabled || fullyRedeemed || expired;
                    return (
                        <div key={r.code} data-testid={`promo-row-${r.code}`}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${inactive ? "bg-cyber-bg/40 border-white/8 opacity-60" : "bg-cyber-bg/65 border-emerald-500/15"}`}>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[12.5px] font-mono font-black text-emerald-200 uppercase">{r.code}</span>
                                    <span className="text-[9px] uppercase tracking-wider text-white/45 bg-white/8 px-1.5 py-0.5 rounded">
                                        {r.type === "ton_bonus" ? `${r.value} TON` : `${r.value} TOKEN`}
                                    </span>
                                    {!r.enabled && <span className="text-[9px] uppercase text-red-300">disabled</span>}
                                    {expired && <span className="text-[9px] uppercase text-amber-300">expired</span>}
                                    {fullyRedeemed && <span className="text-[9px] uppercase text-amber-300">capped</span>}
                                </div>
                                <div className="text-[10px] text-white/45 tabular-nums">
                                    {r.current_redemptions}{r.max_redemptions > 0 ? `/${r.max_redemptions}` : ""} redemptions ·
                                    user_max {r.user_max}
                                    {r.expires_at && <> · expires {new Date(r.expires_at).toLocaleDateString()}</>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => onShowDetails(r.code)} data-testid={`promo-details-${r.code}`}
                                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-white/55 hover:text-white/85 hover:bg-white/8">
                                    <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setEditing(r)} data-testid={`promo-edit-${r.code}`}
                                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-white/55 hover:text-emerald-300 hover:bg-emerald-500/10">
                                    <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => onDelete(r.code)} data-testid={`promo-delete-${r.code}`}
                                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-white/55 hover:text-red-300 hover:bg-red-500/10">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {details && (
                <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDetails(null)}>
                    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md rounded-xl border border-emerald-500/30 bg-cyber-surface p-4">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-[14px] font-black uppercase font-mono text-emerald-200">{details.code}</h3>
                            <button onClick={() => setDetails(null)} className="text-white/55 hover:text-white/85"><XIcon className="w-4 h-4" /></button>
                        </div>
                        <div className="text-[11px] text-white/65 space-y-0.5 font-mono">
                            <div>type: {details.type} · value {details.value}</div>
                            <div>redemptions: {details.current_redemptions}{details.max_redemptions > 0 ? `/${details.max_redemptions}` : " (∞)"}</div>
                            <div>per-user max: {details.user_max}</div>
                            <div>expires: {details.expires_at || "never"}</div>
                            <div>notes: {details.notes || "—"}</div>
                        </div>
                        <div className="mt-3 text-[10.5px] uppercase tracking-wider text-white/45 font-bold">Recent redemptions ({details.recent_redemptions?.length || 0})</div>
                        <div className="mt-1 space-y-0.5 max-h-44 overflow-auto text-[10.5px] text-white/65 font-mono">
                            {(details.recent_redemptions || []).slice(0, 25).map((r, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                    <span className="truncate">user_{(r.user_id || "?").toString().slice(-8)}</span>
                                    <span className="text-white/35">{new Date(r.redeemed_at).toLocaleString()}</span>
                                </div>
                            ))}
                            {(!details.recent_redemptions || details.recent_redemptions.length === 0) && <div className="text-white/35 italic">no redemptions yet</div>}
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
};

export default AdminPromosPage;
