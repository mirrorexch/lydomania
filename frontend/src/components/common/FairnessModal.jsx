/**
 * Phase 8 refactor — generic provably-fair modal.
 *
 * Used by Wheel, Plinko, Mines, Crash. Eliminates the "VERIFY chip is dead"
 * class of bug by centralising the state + wire-up in one component.
 *
 * Props:
 *   • open, onClose
 *   • title             — string already translated by caller
 *   • subtitle          — optional explainer copy
 *   • fields            — [{ label, value, copyable?, mono?, render? }]
 *                          render(value) returns custom JSX (e.g. for 5x5 grid)
 *   • verifyUrl         — fetch path that returns the verify payload
 *   • parseVerify       — (response.data) => [{ label, ok }]  (badge list)
 *   • revealedFields    — optional [{ label, value }] shown AFTER verify
 *   • emptyTitle/empty  — copy shown when no spin/bet/game is selected
 *
 * Polish:
 *   • no native alert, framer-motion with PRM fallback, no black panels
 *   • copy-to-clipboard chips, sonner toasts, haptics
 *   • respects 360px viewport (max-w-md, internal scroll for long fields)
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Shield, X, Check, AlertTriangle, Copy, ExternalLink, Loader2, RotateCw,
} from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { tapMedium, notifySuccess, notifyError } from "@/lib/haptics";
import { sfx } from "@/lib/sound";


const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


async function copyToClipboard(value) {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch { return false; }
}


function Row({ label, value, mono = true, copyable = false, render, testid }) {
    const handleCopy = useCallback(async () => {
        if (!value) return;
        const ok = await copyToClipboard(String(value));
        tapMedium();
        if (ok) {
            sfx.play("scroll_tick", { volume: 0.25 });
            toast.success("Copied to clipboard.");
        } else { toast.error("Couldn't copy."); }
    }, [value]);

    return (
        <div className="rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2" data-testid={testid}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-bold mb-1">{label}</div>
            <div className="flex items-start gap-1.5">
                <div className={`flex-1 min-w-0 text-[11px] leading-snug text-white/85 break-all ${mono ? "font-mono" : ""}`}
                     data-testid={testid ? `${testid}-value` : undefined}>
                    {render ? render(value) : (value ?? "—")}
                </div>
                {copyable && value && (
                    <button type="button" onClick={handleCopy}
                        className="shrink-0 p-1 rounded hover:bg-white/8 text-white/55 hover:text-white transition-colors"
                        aria-label="Copy to clipboard"
                        data-testid={testid ? `${testid}-copy-btn` : undefined}
                    >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
}


function Badge({ label, ok, testid }) {
    return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
            ok ? "bg-emerald-500/12 border-emerald-400/40 text-emerald-200"
               : "bg-rose-500/12 border-rose-400/40 text-rose-200"
        }`} data-testid={testid}>
            {ok ? <Check className="w-4 h-4 shrink-0" aria-hidden="true"/>
                : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true"/>}
            <span className="text-xs font-semibold leading-tight">{label}</span>
        </div>
    );
}


export default function FairnessModal({
    open, onClose,
    title = "Verify",
    subtitle = "Recompute the result from the server seed to confirm fairness.",
    fields = [],
    verifyUrl,
    parseVerify,
    revealedFields,    // optional function (response.data) => [{label, value, copyable?}]
    emptyTitle = "Nothing to verify",
    emptySub   = "Play first — your latest result will appear here.",
}) {
    const [badges, setBadges] = useState(null);
    const [revealed, setRevealed] = useState(null);
    const [busy, setBusy] = useState(false);
    const [derivationNote, setDerivationNote] = useState(null);

    useEffect(() => {
        setBadges(null); setRevealed(null); setDerivationNote(null);
    }, [open, verifyUrl]);

    const runVerify = useCallback(async () => {
        if (!verifyUrl) return;
        setBusy(true); tapMedium();
        try {
            const { data } = await http.get(verifyUrl);
            const parsed = parseVerify ? parseVerify(data) : [];
            setBadges(parsed);
            setDerivationNote(data?.derivation_note || null);
            if (revealedFields) {
                try { setRevealed(revealedFields(data)); } catch { setRevealed(null); }
            }
            const allOk = parsed.length > 0 && parsed.every((b) => !!b.ok);
            if (allOk) {
                sfx.play("success_bell", { volume: 0.45 });
                notifySuccess();
                toast.success("Verified — output matches server seed.");
            } else {
                sfx.play("loss_thud", { volume: 0.35 });
                notifyError();
                toast.error("Mismatch detected — please screenshot and report.");
            }
        } catch (e) {
            sfx.play("loss_thud", { volume: 0.3 });
            notifyError();
            toast.error(e?.response?.data?.detail || "Verification request failed.");
        } finally { setBusy(false); }
    }, [verifyUrl, parseVerify, revealedFields]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: PRM() ? 0 : 0.18 }}
                    onClick={onClose}
                    className="fixed inset-0 z-[60] bg-zinc-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                    data-testid="fairness-modal"
                >
                    <motion.div
                        initial={PRM() ? false : { y: 28, opacity: 0, scale: 0.97 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={PRM() ? { opacity: 0 } : { y: 18, opacity: 0, scale: 0.98 }}
                        transition={{ type: "spring", damping: 26, stiffness: 280 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-zinc-900 border border-white/12 ring-1 ring-fuchsia-300/15"
                    >
                        {/* Header */}
                        <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur px-5 pt-5 pb-4 border-b border-white/8">
                            <button type="button" onClick={onClose}
                                className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-white/5 text-white/55 hover:text-white transition-colors"
                                aria-label="Close fairness panel"
                                data-testid="fairness-close-btn">
                                <X className="w-4 h-4" aria-hidden="true"/>
                            </button>
                            <div className="flex items-center gap-2 mb-1">
                                <Shield className="w-4 h-4 text-fuchsia-300" aria-hidden="true"/>
                                <span className="text-[10px] uppercase tracking-[0.32em] text-fuchsia-300 font-bold">
                                    Provably fair
                                </span>
                            </div>
                            <h2 className="text-xl font-bold text-white" data-testid="fairness-title">{title}</h2>
                            <p className="text-[11px] text-white/65 mt-1 leading-snug">{subtitle}</p>
                        </div>

                        {/* Body */}
                        {(!verifyUrl || !fields.length) ? (
                            <div className="px-5 py-8 text-center" data-testid="fairness-empty">
                                <Shield className="w-9 h-9 mx-auto mb-2 text-white/30" aria-hidden="true"/>
                                <p className="text-sm text-white/70 mb-1">{emptyTitle}</p>
                                <p className="text-[11px] text-white/45">{emptySub}</p>
                            </div>
                        ) : (
                            <>
                                <div className="px-5 py-4 space-y-2">
                                    {fields.map((f, i) => (
                                        <Row key={`${f.label}-${i}`} {...f} testid={f.testid || `fairness-field-${i}`}/>
                                    ))}

                                    {badges && (
                                        <div className="pt-1 space-y-2" data-testid="fairness-result">
                                            <div className={`grid gap-2 ${badges.length >= 3 ? "grid-cols-1" : "grid-cols-2"}`}>
                                                {badges.map((b, i) => (
                                                    <Badge key={`${b.label}-${i}`} label={b.label} ok={b.ok}
                                                        testid={`fairness-badge-${i}`}/>
                                                ))}
                                            </div>
                                            {revealed && revealed.map((r, i) => (
                                                <Row key={`reveal-${i}`} {...r} testid={`fairness-revealed-${i}`}/>
                                            ))}
                                            {derivationNote && (
                                                <div className="rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2.5 text-[11px] text-white/60 leading-snug">
                                                    <span className="text-white/45 font-mono uppercase tracking-wider text-[9px] block mb-1">
                                                        Derivation
                                                    </span>
                                                    {derivationNote}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="px-5 pb-5 pt-1">
                                    <button type="button" onClick={runVerify} disabled={busy || !verifyUrl}
                                        className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-400 to-cyan-400 text-zinc-950 font-bold text-sm shadow-lg hover:from-fuchsia-300 hover:to-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        data-testid="fairness-verify-btn">
                                        {busy
                                            ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true"/> Verifying…</>
                                            : badges
                                                ? <><RotateCw className="w-4 h-4" aria-hidden="true"/> Re-run verification</>
                                                : <><Shield className="w-4 h-4" aria-hidden="true"/> Run verification</>}
                                    </button>
                                    <a href="https://en.wikipedia.org/wiki/Provably_fair" target="_blank" rel="noreferrer noopener"
                                       className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-white/45 hover:text-white/75 transition-colors"
                                       data-testid="fairness-learn-more">
                                        Learn more <ExternalLink className="w-3 h-3" aria-hidden="true"/>
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
