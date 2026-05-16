import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    SlidersHorizontal, Loader2, Save, Network, Users as UsersIcon,
    Zap, Shield as ShieldIcon, ExternalLink, Check, AlertTriangle,
    RefreshCw, Wrench, ChevronDown, ChevronRight,
} from "lucide-react";
import {
    adminGetSettings, adminPatchSettings, adminPortalsAuth, adminPortalsTest,
    adminMaintenanceSyncAll,
} from "@/lib/api";

const Section = ({ icon: Icon, title, subtitle, children }) => (
    <div className="rounded-xl bg-cyber-surface border border-white/10 p-3.5 mb-3">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase font-black tracking-[0.2em] text-cyber-cyan mb-0.5">
            <Icon className="w-3.5 h-3.5" /> {title}
        </div>
        {subtitle && <div className="text-[10.5px] text-white/45 mb-2">{subtitle}</div>}
        <div className="flex flex-col gap-2 mt-2">{children}</div>
    </div>
);

const Field = ({ label, hint, children }) => (
    <div>
        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">{label}</label>
        <div className="mt-1">{children}</div>
        {hint && <div className="text-[9.5px] text-white/35 mt-0.5">{hint}</div>}
    </div>
);

const Toggle = ({ value, onChange, testid, label }) => (
    <button onClick={() => onChange(!value)} data-testid={testid}
        className={`inline-flex items-center gap-2 text-[11px] font-bold transition px-2 py-1 rounded-lg border ${
            value ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-white/5 border-white/10 text-white/60"
        }`}>
        <span className={`w-7 h-3.5 rounded-full relative transition ${value ? "bg-emerald-400/60" : "bg-white/15"}`}>
            <span className={`absolute top-0 w-3.5 h-3.5 rounded-full bg-white transition ${value ? "left-3.5" : "left-0"}`} />
        </span>
        {label}
    </button>
);

const NumInput = ({ value, onChange, testid, ...rest }) => (
    <input type="number" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} {...rest}
        className="w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none" />
);

export const AdminSettingsPage = () => {
    const [s, setS] = useState(null);
    const [busy, setBusy] = useState(false);
    const [portalsBusy, setPortalsBusy] = useState(false);
    const [portalsAuthText, setPortalsAuthText] = useState("");
    const [portalsTestResult, setPortalsTestResult] = useState(null);
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncReport, setSyncReport] = useState(null);
    const [syncReportOpen, setSyncReportOpen] = useState(false);
    const [dryRun, setDryRun] = useState(true);

    const reload = useCallback(async () => {
        try {
            const r = await adminGetSettings();
            setS(r);
        } catch (e) {
            toast.error("Failed to load settings", { description: e?.message });
        }
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const set = (k, v) => setS((p) => ({ ...p, [k]: v }));

    const handleSave = async () => {
        if (!s || busy) return;
        setBusy(true);
        try {
            const patch = { ...s };
            delete patch.portals_auth_data_set;  // server-side derived
            // Coerce numbers
            ["floor_watcher_interval_seconds", "auto_fulfill_threshold_ton",
                "auto_fulfill_daily_cap_ton", "referral_bronze_pct", "referral_silver_pct",
                "referral_silver_threshold", "referral_gold_pct", "referral_gold_threshold",
                "max_referrals_per_day_per_user"
            ].forEach((k) => { if (patch[k] !== undefined) patch[k] = Number(patch[k]); });
            await adminPatchSettings(patch);
            toast.success("Settings saved");
            await reload();
        } catch (e) {
            toast.error("Save failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    const handlePortalsAuthSave = async () => {
        if (!portalsAuthText || portalsBusy) return;
        setPortalsBusy(true);
        try {
            const r = await adminPortalsAuth(portalsAuthText);
            toast.success("Portals auth stored", { description: `fp=${r.fingerprint}` });
            setPortalsAuthText("");
            await reload();
        } catch (e) {
            toast.error("Save failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setPortalsBusy(false);
        }
    };
    const handlePortalsTest = async () => {
        setPortalsBusy(true);
        try {
            const r = await adminPortalsTest();
            setPortalsTestResult(r);
        } catch (e) {
            setPortalsTestResult({ ok: false, error: e?.response?.data?.detail || e?.message });
        } finally {
            setPortalsBusy(false);
        }
    };

    const handleSyncAll = async () => {
        if (syncBusy) return;
        if (!dryRun) {
            const confirmed = window.confirm(
                "This will OVERWRITE live floors → items, then recompute every case's basket.\n\n" +
                "Existing inventory rows are NOT affected (payouts frozen).\n\n" +
                "Continue?",
            );
            if (!confirmed) return;
        }
        setSyncBusy(true);
        setSyncReport(null);
        try {
            const r = await adminMaintenanceSyncAll({
                apply: !dryRun,
                maxPayoutMultiplier: s?.max_payout_multiplier,
            });
            setSyncReport(r);
            setSyncReportOpen(true);
            const okCount = r?.cases_recalib?.cases_ok ?? 0;
            const totalCount = r?.cases_recalib?.cases_total ?? 0;
            toast.success(
                dryRun ? "Sync preview ready" : "Sync applied",
                { description: `${okCount}/${totalCount} cases recalibrated · ${r?.items_sync?.items_updated || 0} item floors updated` },
            );
            await reload();
        } catch (e) {
            toast.error("Sync failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setSyncBusy(false);
        }
    };

    if (!s) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>;

    return (
        <div data-testid="admin-settings-page">
            {/* Phase 3c — Maintenance / Sync All */}
            <Section icon={Wrench} title="Maintenance · Sync Live Floors" subtitle="Refresh Fragment floors → items → recompute case baskets at target RTP">
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Max payout multiplier" hint="basket payout cap = case.price_ton × this">
                        <NumInput value={s.max_payout_multiplier ?? 200} onChange={(v) => set("max_payout_multiplier", v)} testid="settings-max-payout-mult" min={10} max={10000} step="10" />
                    </Field>
                    <Field label="Mode" hint="Dry-run shows diff without writing">
                        <Toggle value={dryRun} onChange={setDryRun} testid="maintenance-dryrun-toggle" label={dryRun ? "Dry-run preview" : "Apply changes"} />
                    </Field>
                </div>
                <button
                    onClick={handleSyncAll} disabled={syncBusy}
                    data-testid="maintenance-sync-all-btn"
                    className="w-full inline-flex items-center justify-center gap-1.5 text-[10.5px] font-black uppercase tracking-wider px-3 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40 transition"
                >
                    {syncBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {dryRun ? "Run Sync Preview" : "Sync All Now"}
                </button>
                {syncReport && (
                    <div className="rounded-lg border border-white/10 bg-cyber-bg/60 p-2.5 mt-1" data-testid="maintenance-sync-report">
                        <button onClick={() => setSyncReportOpen((o) => !o)}
                            className="w-full flex items-center justify-between gap-2 text-[10.5px] font-bold uppercase tracking-wider text-white/70">
                            <span className="inline-flex items-center gap-1.5">
                                {syncReportOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                Report ({syncReport.applied ? "applied" : "dry-run"})
                            </span>
                            <span className="text-emerald-300 font-mono">
                                {syncReport.cases_recalib?.cases_ok ?? 0}/{syncReport.cases_recalib?.cases_total ?? 0} cases · {syncReport.items_sync?.items_updated || 0} items
                            </span>
                        </button>
                        {syncReportOpen && (
                            <div className="text-[10px] mt-2 space-y-1.5 font-mono">
                                <div className="text-white/55">
                                    Watch: {syncReport.watch?.ok || 0} ok / {syncReport.watch?.fail || 0} fail · {syncReport.watch?.duration_s || "?"}s
                                </div>
                                {(syncReport.cases_recalib?.reports || []).map((r) => (
                                    <div key={r.case_id} className={`rounded-md border px-2 py-1 ${r.ok ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-200" : "bg-red-500/8 border-red-500/30 text-red-200"}`} data-testid={`sync-report-row-${r.case_id}`}>
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold">{r.case_id}</span>
                                            {r.ok ? (
                                                <span>{r.realized_ev_pct?.toFixed?.(2)}% · drift {r.drift_pct >= 0 ? "+" : ""}{r.drift_pct?.toFixed?.(2)}%</span>
                                            ) : (
                                                <span className="text-red-300">✗ {r.error}</span>
                                            )}
                                        </div>
                                        {r.ok && (
                                            <div className="text-white/50 mt-0.5">
                                                kept {r.kept_count} · dropped {r.dropped_count} · cap {r.max_payout_cap_ton}
                                                {r.jackpot_slug && <> · jackpot {r.jackpot_slug} w={r.jackpot_weight?.toFixed?.(4)}</>}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </Section>

            {/* Pricing & Floor */}
            <Section icon={Network} title="Pricing & Floor Watcher" subtitle="Live floor prices from Fragment/Portals">
                <Toggle value={s.floor_watcher_enabled} onChange={(v) => set("floor_watcher_enabled", v)} testid="settings-floor-toggle" label="Floor watcher enabled" />
                <Field label="Poll interval (seconds)" hint="Range 30–3600. Phase 3b worker reads this.">
                    <NumInput value={s.floor_watcher_interval_seconds} onChange={(v) => set("floor_watcher_interval_seconds", v)} testid="settings-floor-interval" min={30} max={3600} />
                </Field>
                <Toggle value={s.use_live_portals_pricing} onChange={(v) => set("use_live_portals_pricing", v)} testid="settings-live-portals-toggle" label="Use live Portals pricing (vs Fragment scrape)" />
            </Section>

            {/* Portals integration */}
            <Section icon={ExternalLink} title="Portals Integration" subtitle="Paste Telegram Mini App initData from the Portals app to enable live listings">
                <div className="text-[10.5px] text-white/55 leading-snug mb-1 p-2 bg-cyber-bg/60 rounded-md border border-white/8">
                    Open <b className="text-white">@portals</b> in Telegram, inspect via Mini-App debugger,
                    copy the <code className="text-cyber-cyan">initData</code> string, paste below.
                </div>
                <textarea value={portalsAuthText} onChange={(e) => setPortalsAuthText(e.target.value)} placeholder="query_id=…&user=…&hash=…"
                    rows={3} data-testid="settings-portals-auth-textarea"
                    className="w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none resize-none" />
                <div className="flex gap-2">
                    <button onClick={handlePortalsAuthSave} disabled={!portalsAuthText || portalsBusy}
                        data-testid="settings-portals-save-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-cyber-cyan/15 border border-cyber-cyan/40 text-cyber-cyan hover:bg-cyber-cyan/25 disabled:opacity-40">
                        {portalsBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save authData
                    </button>
                    <button onClick={handlePortalsTest} disabled={portalsBusy}
                        data-testid="settings-portals-test-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-cyber-purple/15 border border-cyber-purple/40 text-cyber-purple hover:bg-cyber-purple/25 disabled:opacity-40">
                        Test connection
                    </button>
                </div>
                {s.portals_auth_data_set && (
                    <div className="text-[10px] text-emerald-300/85 inline-flex items-center gap-1 mt-1">
                        <Check className="w-2.5 h-2.5" /> authData currently stored (encrypted)
                    </div>
                )}
                {portalsTestResult && (
                    <div className={`text-[10.5px] rounded-md border px-2.5 py-1.5 mt-1 ${
                        portalsTestResult.ok ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-amber-500/10 border-amber-500/40 text-amber-200"
                    }`} data-testid="settings-portals-test-result">
                        <div className="font-bold">{portalsTestResult.ok ? "OK" : portalsTestResult.error || "Failed"}</div>
                        {portalsTestResult.suggestion && <div className="text-[10px] mt-0.5 opacity-80">{portalsTestResult.suggestion}</div>}
                    </div>
                )}
            </Section>

            {/* Auto-fulfill */}
            <Section icon={Zap} title="Auto-Fulfill (experimental)" subtitle="Phase 3b ships rails only. Real on-chain send is stubbed.">
                <Toggle value={s.auto_fulfill_enabled} onChange={(v) => set("auto_fulfill_enabled", v)} testid="settings-autofulfill-toggle" label="Auto-fulfill enabled" />
                <Toggle value={s.auto_fulfill_dry_run} onChange={(v) => set("auto_fulfill_dry_run", v)} testid="settings-autofulfill-dry-run-toggle" label="Dry-run mode (recommended ON)" />
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Threshold TON" hint="Skip auto if payout > this">
                        <NumInput value={s.auto_fulfill_threshold_ton} onChange={(v) => set("auto_fulfill_threshold_ton", v)} testid="settings-autofulfill-threshold" min={0} step="0.1" />
                    </Field>
                    <Field label="Daily cap TON" hint="Worker stops after this">
                        <NumInput value={s.auto_fulfill_daily_cap_ton} onChange={(v) => set("auto_fulfill_daily_cap_ton", v)} testid="settings-autofulfill-cap" min={0} step="1" />
                    </Field>
                </div>
            </Section>

            {/* Referral ladder */}
            <Section icon={UsersIcon} title="Referral Ladder" subtitle="Bronze→Silver→Gold tier rates and thresholds">
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Bronze %">
                        <NumInput value={s.referral_bronze_pct} onChange={(v) => set("referral_bronze_pct", v)} testid="settings-bronze-pct" min={0} max={50} step="0.1" />
                    </Field>
                    <div />
                    <Field label="Silver %">
                        <NumInput value={s.referral_silver_pct} onChange={(v) => set("referral_silver_pct", v)} testid="settings-silver-pct" min={0} max={50} step="0.1" />
                    </Field>
                    <Field label="Silver @ N referees">
                        <NumInput value={s.referral_silver_threshold} onChange={(v) => set("referral_silver_threshold", v)} testid="settings-silver-thr" min={1} max={10000} />
                    </Field>
                    <Field label="Gold %">
                        <NumInput value={s.referral_gold_pct} onChange={(v) => set("referral_gold_pct", v)} testid="settings-gold-pct" min={0} max={50} step="0.1" />
                    </Field>
                    <Field label="Gold @ N referees">
                        <NumInput value={s.referral_gold_threshold} onChange={(v) => set("referral_gold_threshold", v)} testid="settings-gold-thr" min={1} max={10000} />
                    </Field>
                </div>
            </Section>

            {/* Anti-abuse */}
            <Section icon={ShieldIcon} title="Anti-abuse" subtitle="Defaults are sensible — only loosen if necessary">
                <Toggle value={s.self_referral_blocked} onChange={(v) => set("self_referral_blocked", v)} testid="settings-selfref-toggle" label="Block self-referral" />
                <Field label="Max referees per day per user" hint="Hard cap on new referees tagged to one referrer per day">
                    <NumInput value={s.max_referrals_per_day_per_user} onChange={(v) => set("max_referrals_per_day_per_user", v)} testid="settings-daily-cap" min={1} max={10000} />
                </Field>
            </Section>

            {/* Save bar */}
            <div className="sticky bottom-20 -mx-4 px-4 pt-2 pb-2 bg-gradient-to-t from-cyber-bg via-cyber-bg/95 to-transparent backdrop-blur-sm">
                <button onClick={handleSave} disabled={busy} data-testid="settings-save-btn"
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-3 disabled:opacity-40 bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save all settings
                </button>
            </div>
        </div>
    );
};

export default AdminSettingsPage;
