/**
 * Phase 6e — Admin Roulette config (sell threshold knob).
 */
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Save, Settings as Cog } from "lucide-react";
import { adminGetRouletteConfig, adminSetRouletteConfig } from "@/lib/api";


export const AdminRouletteConfigPage = () => {
    const { t } = useTranslation();
    const [threshold, setThreshold] = useState("100");
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const data = await adminGetRouletteConfig();
                setThreshold(String(data.sell_threshold_ton));
                setUpdatedAt(data.updated_at);
            } catch (e) {
                toast.error(e?.response?.data?.detail || "load failed");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const save = async () => {
        const v = Number(threshold);
        if (!Number.isFinite(v) || v < 0) {
            toast.error(t("sell_review.config.bad_value"));
            return;
        }
        setSaving(true);
        try {
            const data = await adminSetRouletteConfig(v);
            setUpdatedAt(data.updated_at);
            toast.success(t("sell_review.config.saved_toast"));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div data-testid="admin-roulette-config-page" className="space-y-4">
            <h2 className="font-display text-lg font-black tracking-tight inline-flex items-center gap-1.5">
                <Cog className="w-4 h-4 text-cyber-cyan" /> {t("sell_review.config.title")}
            </h2>
            <p className="text-xs text-white/55 leading-relaxed">
                {t("sell_review.config.description")}
            </p>

            <div className="bg-cyber-surface/60 border border-white/10 rounded-xl p-4 space-y-3 max-w-md">
                <label className="block">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55 mb-1.5">
                        {t("sell_review.config.threshold_label")}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            data-testid="roulette-config-threshold-input"
                            type="number"
                            min={0}
                            step="1"
                            value={threshold}
                            disabled={loading || saving}
                            onChange={(e) => setThreshold(e.target.value)}
                            className="flex-1 bg-cyber-bg border border-white/15 focus:border-cyber-cyan/55 rounded-lg px-3 py-2 font-mono text-sm tabular-nums outline-none transition disabled:opacity-60"
                        />
                        <span className="text-white/50 text-sm font-bold">TON</span>
                    </div>
                </label>

                <button
                    onClick={save}
                    disabled={loading || saving}
                    data-testid="roulette-config-save-btn"
                    className="w-full bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-display font-bold uppercase tracking-wider text-xs rounded-lg py-2.5 disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {t("sell_review.config.save")}
                </button>

                {updatedAt && (
                    <div className="text-[10px] text-white/35 text-center">
                        {t("sell_review.config.updated_at", { at: updatedAt })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminRouletteConfigPage;
