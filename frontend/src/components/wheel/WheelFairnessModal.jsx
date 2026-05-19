/**
 * Phase 7b Fix-A — Wheel Provably-Fair modal.
 *
 * Closes the 7b acceptance gap by surfacing the commit-reveal data the
 * backend already returns on every spin and exposes via
 *   GET /api/wheel/spins/{spin_id}/verify
 *
 * Triggered from:
 *   1. The "Provably Fair" pill on the WheelPage hero
 *   2. The per-row "verify" link in the spin history list
 *
 * Behaviour:
 *   • Receives a `spin` prop (latest or selected) with `spin_id`,
 *     `server_seed_hash`, `segment_index`. Renders these unconditionally.
 *   • "Verify" button hits `/api/wheel/spins/{spin_id}/verify`
 *     and renders two green/red badges: server_seed_hash_matches +
 *     segment_index_matches. Also reveals the full server_seed.
 *   • If no spin is provided → shows the "spin once to verify" empty state.
 *
 * Polish:
 *   • No native alert / confirm
 *   • framer-motion entrance respects prefers-reduced-motion
 *   • No black panels — cyber-surface with subtle ring
 *   • 360px-safe (single column at narrow widths)
 *   • Every interactive has data-testid
 *   • i18n strings sourced from `wheel.fair.*` namespace (en + ru parity)
 */
import React, { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Shield, X, Check, AlertTriangle, Copy, ExternalLink, Disc3, Loader2, RotateCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { tapMedium, notifySuccess, notifyError } from "@/lib/haptics";
import { sfx } from "@/lib/sound";


const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


function shortHash(h, head = 8, tail = 6) {
    if (!h || typeof h !== "string") return "—";
    if (h.length <= head + tail + 1) return h;
    return `${h.slice(0, head)}…${h.slice(-tail)}`;
}


async function copyToClipboard(value) {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
        // Fallback (older WebViews)
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}


/** Single fact-row: label + value + copy-to-clipboard. */
const FactRow = ({ label, value, mono = true, testid }) => {
    const { t } = useTranslation();
    const handleCopy = useCallback(async () => {
        if (!value) return;
        const ok = await copyToClipboard(String(value));
        tapMedium();
        if (ok) {
            toast.success(t("wheel.fair.toast.copied"));
            sfx.play("scroll_tick", { volume: 0.25 });
        } else {
            toast.error(t("wheel.fair.toast.copy_failed"));
        }
    }, [value, t]);

    return (
        <div className="rounded-lg bg-white/[0.03] border border-white/8 px-3 py-2" data-testid={testid}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-bold mb-1">
                {label}
            </div>
            <div className="flex items-center gap-1.5">
                <code
                    className={`flex-1 text-[11px] leading-snug text-white/85 break-all ${mono ? "font-mono" : ""}`}
                    data-testid={testid ? `${testid}-value` : undefined}
                >
                    {value ?? "—"}
                </code>
                {value && (
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="shrink-0 p-1 rounded hover:bg-white/8 transition-colors text-white/55 hover:text-white"
                        aria-label={t("wheel.fair.aria.copy")}
                        data-testid={testid ? `${testid}-copy-btn` : undefined}
                    >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
};


/** A binary check badge: green tick if true, red triangle if false. */
const VerifyBadge = ({ label, ok, testid }) => (
    <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
            ok
                ? "bg-emerald-500/12 border-emerald-400/40 text-emerald-200"
                : "bg-rose-500/12 border-rose-400/40 text-rose-200"
        }`}
        data-testid={testid}
    >
        {ok
            ? <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
        <span className="text-xs font-semibold leading-tight">{label}</span>
    </div>
);


export default function WheelFairnessModal({ open, onClose, spin }) {
    const { t } = useTranslation();
    const [verification, setVerification] = useState(null);
    const [busy, setBusy] = useState(false);

    // Reset verification whenever the modal opens for a different spin
    useEffect(() => {
        setVerification(null);
    }, [open, spin?.spin_id]);

    const handleVerify = useCallback(async () => {
        if (!spin?.spin_id) return;
        setBusy(true);
        tapMedium();
        try {
            const { data } = await http.get(`/wheel/spins/${spin.spin_id}/verify`);
            setVerification(data);
            const allOk = !!data?.server_seed_hash_matches && !!data?.segment_index_matches;
            if (allOk) {
                sfx.play("success_bell", { volume: 0.45 });
                notifySuccess();
                toast.success(t("wheel.fair.toast.verified"));
            } else {
                sfx.play("loss_thud", { volume: 0.4 });
                notifyError();
                toast.error(t("wheel.fair.toast.mismatch"));
            }
        } catch (e) {
            sfx.play("loss_thud", { volume: 0.35 });
            notifyError();
            toast.error(e?.response?.data?.detail || t("wheel.fair.toast.verify_failed"));
        } finally {
            setBusy(false);
        }
    }, [spin?.spin_id, t]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: PRM() ? 0 : 0.18 }}
                    className="fixed inset-0 z-[60] bg-cyber-bg/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                    onClick={onClose}
                    data-testid="wheel-fairness-modal"
                >
                    <motion.div
                        initial={PRM() ? false : { y: 28, opacity: 0, scale: 0.97 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={PRM() ? { opacity: 0 } : { y: 18, opacity: 0, scale: 0.98 }}
                        transition={{ type: "spring", damping: 26, stiffness: 280 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-md rounded-3xl bg-cyber-surface border border-white/12 ring-1 ring-fuchsia-300/15 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="relative px-5 pt-5 pb-4 border-b border-white/8">
                            <button
                                type="button"
                                onClick={onClose}
                                className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-white/5 text-white/55 hover:text-white transition-colors"
                                aria-label={t("wheel.fair.aria.close")}
                                data-testid="wheel-fairness-close-btn"
                            >
                                <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <div className="flex items-center gap-2 mb-1">
                                <Shield className="w-4 h-4 text-fuchsia-300" aria-hidden="true" />
                                <span className="text-[10px] uppercase tracking-[0.32em] text-fuchsia-300 font-bold">
                                    {t("wheel.fair.tag")}
                                </span>
                            </div>
                            <h2 className="text-xl font-bold text-white" data-testid="wheel-fairness-title">
                                {t("wheel.fair.title")}
                            </h2>
                            <p className="text-[11px] text-white/65 mt-1 leading-snug max-w-sm">
                                {t("wheel.fair.subtitle")}
                            </p>
                        </div>

                        {/* Body */}
                        {!spin?.spin_id ? (
                            <div
                                className="px-5 py-8 text-center"
                                data-testid="wheel-fairness-empty"
                            >
                                <Disc3 className="w-9 h-9 mx-auto mb-2 text-white/30" aria-hidden="true" />
                                <p className="text-sm text-white/70 mb-1">
                                    {t("wheel.fair.empty_title")}
                                </p>
                                <p className="text-[11px] text-white/45">
                                    {t("wheel.fair.empty_sub")}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="px-5 py-4 space-y-2">
                                    <FactRow
                                        label={t("wheel.fair.field.spin_id")}
                                        value={spin.spin_id}
                                        testid="wheel-fairness-spinid"
                                    />
                                    <FactRow
                                        label={t("wheel.fair.field.server_seed_hash")}
                                        value={spin.server_seed_hash}
                                        testid="wheel-fairness-serverhash"
                                    />
                                    <FactRow
                                        label={t("wheel.fair.field.client_seed")}
                                        value={spin.spin_id}
                                        testid="wheel-fairness-clientseed"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <FactRow
                                            label={t("wheel.fair.field.segment_index")}
                                            value={spin.segment_index ?? "—"}
                                            mono
                                            testid="wheel-fairness-segidx"
                                        />
                                        <FactRow
                                            label={t("wheel.fair.field.spun_at")}
                                            value={spin.spun_at ? new Date(spin.spun_at).toLocaleString() : "—"}
                                            mono={false}
                                            testid="wheel-fairness-spunat"
                                        />
                                    </div>

                                    {verification && (
                                        <div className="pt-1 space-y-2" data-testid="wheel-fairness-result">
                                            <div className="grid grid-cols-2 gap-2">
                                                <VerifyBadge
                                                    label={t("wheel.fair.badge.hash_match")}
                                                    ok={!!verification.server_seed_hash_matches}
                                                    testid="wheel-fairness-badge-hash"
                                                />
                                                <VerifyBadge
                                                    label={t("wheel.fair.badge.segment_match")}
                                                    ok={!!verification.segment_index_matches}
                                                    testid="wheel-fairness-badge-segment"
                                                />
                                            </div>
                                            <FactRow
                                                label={t("wheel.fair.field.server_seed_revealed")}
                                                value={verification.server_seed}
                                                testid="wheel-fairness-revealed-seed"
                                            />
                                            <div className="rounded-lg bg-white/[0.02] border border-white/8 px-3 py-2.5 text-[11px] text-white/60 leading-snug">
                                                <span className="text-white/45 font-mono uppercase tracking-wider text-[9px] block mb-1">
                                                    {t("wheel.fair.derivation_label")}
                                                </span>
                                                {verification.derivation_note}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer / Verify CTA */}
                                <div className="px-5 pb-5 pt-1">
                                    <button
                                        type="button"
                                        onClick={handleVerify}
                                        disabled={busy}
                                        className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-400 to-cyan-400 text-cyber-bg font-bold text-sm shadow-lg shadow-fuchsia-500/20 hover:from-fuchsia-300 hover:to-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        data-testid="wheel-fairness-verify-btn"
                                    >
                                        {busy ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                                {t("wheel.fair.verifying")}
                                            </>
                                        ) : verification ? (
                                            <>
                                                <RotateCw className="w-4 h-4" aria-hidden="true" />
                                                {t("wheel.fair.re_verify")}
                                            </>
                                        ) : (
                                            <>
                                                <Shield className="w-4 h-4" aria-hidden="true" />
                                                {t("wheel.fair.verify_cta")}
                                            </>
                                        )}
                                    </button>
                                    <a
                                        href="https://en.wikipedia.org/wiki/Provably_fair"
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-white/45 hover:text-white/75 transition-colors"
                                        data-testid="wheel-fairness-learn-more"
                                    >
                                        {t("wheel.fair.learn_more")}
                                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                    </a>
                                </div>
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
