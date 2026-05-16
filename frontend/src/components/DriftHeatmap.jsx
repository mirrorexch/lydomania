/**
 * Phase 4a — Drift heatmap widget for /admin/cases.
 *
 * Renders a horizontal row of N tiles (one per case) with:
 *   • case name + price
 *   • theoretical RTP vs target (color: green ≤0.5% | amber ≤2% | red >2%)
 *   • realized RTP from last `window_days` of opens
 *   • 7-day sparkline of opens-per-day (SVG)
 *
 * Click a tile → fires `onTileClick(caseId)`.
 *
 * Data source: GET /api/admin/cases/heatmap?window_days=7
 */
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { adminCasesHeatmap } from "@/lib/api";

function tone(drift) {
    const a = Math.abs(drift || 0);
    if (a <= 0.5) return { ring: "border-emerald-500/45", text: "text-emerald-300", bg: "bg-emerald-500/8", dot: "bg-emerald-400" };
    if (a <= 2) return { ring: "border-amber-500/45", text: "text-amber-300", bg: "bg-amber-500/8", dot: "bg-amber-400" };
    return { ring: "border-red-500/50", text: "text-red-300", bg: "bg-red-500/10", dot: "bg-red-400" };
}

function Sparkline({ data, width = 96, height = 22, stroke = "currentColor" }) {
    if (!data || !data.length) return <div className="text-[9px] text-white/30">—</div>;
    const max = Math.max(...data, 1);
    const min = 0;
    const stepX = width / Math.max(1, data.length - 1);
    const points = data.map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / (max - min || 1)) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
            <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            {/* Last point dot */}
            <circle cx={(data.length - 1) * stepX} cy={height - ((data[data.length - 1] - min) / (max - min || 1)) * height} r="2" fill={stroke} />
        </svg>
    );
}

export function DriftHeatmap({ onTileClick, refreshKey = 0 }) {
    const [rows, setRows] = useState(null);
    const [meta, setMeta] = useState({});
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true); setErr(null);
        try {
            const r = await adminCasesHeatmap({ windowDays: 7 });
            setRows(r.rows || []);
            setMeta({ window_days: r.window_days, generated_at: r.generated_at });
        } catch (e) {
            setErr(e?.response?.data?.detail || e?.message || "load failed");
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    return (
        <div data-testid="drift-heatmap" className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="text-[10.5px] uppercase tracking-[0.18em] text-white/55 font-bold">
                        Live drift · last {meta.window_days || 7}d
                    </div>
                    {busy && <Loader2 className="w-3 h-3 animate-spin text-white/40" />}
                </div>
                <button
                    type="button"
                    onClick={load}
                    disabled={busy}
                    data-testid="drift-heatmap-refresh"
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition"
                >
                    <RefreshCw className="w-3 h-3" />
                    refresh
                </button>
            </div>

            {err && (
                <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5 inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> {err}
                </div>
            )}

            {rows && rows.length === 0 && !err && (
                <div className="text-[11px] text-white/40">No cases configured.</div>
            )}

            {rows && rows.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                    {rows.map((r) => {
                        const t = tone(r.theoretical_drift_pct);
                        const tr = tone(r.realized_drift_pct);
                        return (
                            <button
                                key={r.case_id}
                                type="button"
                                onClick={() => onTileClick && onTileClick(r.case_id)}
                                data-testid={`drift-tile-${r.case_id}`}
                                className={`text-left rounded-lg border ${t.ring} ${t.bg} px-2.5 py-2 transition hover:brightness-125 hover:scale-[1.01]`}
                            >
                                <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0">
                                        <div className="text-[11px] font-bold text-white/90 truncate" title={r.name}>{r.name}</div>
                                        <div className="text-[9.5px] uppercase tracking-wider text-white/40">
                                            {r.price_ton} TON · {r.opens_total} opens
                                        </div>
                                    </div>
                                    <span className={`w-1.5 h-1.5 rounded-full ${t.dot} shrink-0 mt-1`} />
                                </div>
                                <div className="mt-1.5 space-y-0.5">
                                    <div className="flex items-baseline justify-between text-[10px] font-mono">
                                        <span className="text-white/45">target</span>
                                        <span className="text-white/80">{r.target_ev_pct?.toFixed?.(1)}%</span>
                                    </div>
                                    <div className="flex items-baseline justify-between text-[10px] font-mono">
                                        <span className="text-white/45">math</span>
                                        <span className={`${t.text} font-bold`}>{r.theoretical_ev_pct?.toFixed?.(2)}%</span>
                                    </div>
                                    <div className="flex items-baseline justify-between text-[10px] font-mono">
                                        <span className="text-white/45">real</span>
                                        <span className={`${tr.text} font-bold`}>
                                            {r.opens_total > 0 ? `${r.realized_rtp_pct?.toFixed?.(1)}%` : "—"}
                                        </span>
                                    </div>
                                </div>
                                <div className={`mt-1.5 flex items-center justify-between gap-1 ${t.text}`}>
                                    <Sparkline data={r.opens_per_day || []} />
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default DriftHeatmap;
