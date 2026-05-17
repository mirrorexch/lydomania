/**
 * Phase 4b — User-facing promo redeem input.
 */
import React, { useState } from "react";
import { Ticket, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { promoRedeem } from "@/lib/api";
import { sfx } from "@/lib/sound";

export const PromoRedeemField = ({ onRedeemed, className = "" }) => {
    const { t } = useTranslation();
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e?.preventDefault?.();
        const c = code.trim().toUpperCase();
        if (!c || c.length < 3) return;
        setBusy(true);
        try {
            const r = await promoRedeem(c);
            sfx.play("promo_redeem", { volume: 0.7 });
            const applied = r.applied || {};
            const desc = applied.type === "ton_bonus"
                ? t("promo.applied_ton", { ton: applied.credited_ton, balance: applied.new_balance_ton })
                : t("promo.applied_tokens", { tokens: applied.tokens_added, total: applied.free_spin_tokens });
            toast.success(t("promo.applied_title", { code: r.code }), {
                description: desc,
                icon: <Check className="w-4 h-4" />,
            });
            setCode("");
            onRedeemed?.(r);
        } catch (err) {
            const detail = err?.response?.data?.detail || err?.message || t("promo.failed_default");
            toast.error(t("promo.failed_title"), { description: detail, icon: <X className="w-4 h-4" /> });
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className={`flex items-center gap-1.5 ${className}`} data-testid="promo-redeem-form">
            <div className="relative flex-1 min-w-0">
                <Ticket className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={t("promo.placeholder")}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck="false"
                    maxLength={32}
                    data-testid="promo-redeem-input"
                    className="w-full bg-cyber-bg/80 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[12px] font-mono uppercase tracking-wider text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
                />
            </div>
            <button
                type="submit"
                disabled={busy || code.trim().length < 3}
                data-testid="promo-redeem-btn"
                className="inline-flex items-center gap-1 text-[10.5px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40 transition"
            >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {t("promo.redeem")}
            </button>
        </form>
    );
};

export default PromoRedeemField;
