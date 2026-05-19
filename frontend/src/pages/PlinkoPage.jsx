/**
 * Phase 8 — Plinko page.
 *
 * Compact UI: rows/risk selector, bet input, big "Drop ball" CTA,
 * animated bucket reveal, history list with per-row VERIFY chip.
 * 14-point polish honoured (overflow-x-hidden, full i18n via inline,
 * haptics + sfx, framer-motion + PRM, no native alert).
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleDot, Coins, Shield, ChevronRight, Loader2, History } from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";
import FairnessModal from "@/components/common/FairnessModal";
import { fireLegendaryBurst } from "@/lib/celebrations";


const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


function bucketColor(mult) {
    // Phase 11.1 — Plinko bucket strip on the gold-luxe gradient.
    //   low → --gold-900 deep brown-gold ; mid → --gold-500 primary ;
    //   top → --gold-bright with pulse-glow ring.
    if (mult >= 50) return "bg-gold-bright/35 border-gold-bright/65 text-gold-bright shadow-[0_0_18px_-2px_rgba(255,215,0,0.65)] animate-pulse-glow";
    if (mult >= 10) return "bg-gold-bright/22 border-gold-bright/55 text-gold-bright shadow-[0_0_12px_-2px_rgba(255,215,0,0.55)]";
    if (mult >= 2)  return "bg-gold-500/22 border-gold-500/55 text-gold-200";
    if (mult >= 1)  return "bg-gold-700/22 border-gold-700/50 text-gold-300";
    return "bg-gold-900/35 border-gold-900/60 text-gold-200/65";
}


export default function PlinkoPage({ user, balance, refreshBalance }) {
    const [config, setConfig] = useState(null);
    const [rows, setRows] = useState(8);
    const [risk, setRisk] = useState("medium");
    const [bet, setBet] = useState("1");
    const [dropping, setDropping] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [history, setHistory] = useState([]);
    // Fix-D: provably-fair modal state
    const [verifyBet, setVerifyBet] = useState(null);   // { bet_id, ... } from history or lastResult
    const fairnessOpen = !!verifyBet;

    useEffect(() => {
        (async () => {
            try {
                const { data } = await http.get("/plinko/config");
                setConfig(data);
            } catch (_) { toast.error("Couldn't load Plinko config."); }
        })();
    }, []);

    const refreshHistory = useCallback(async () => {
        try {
            const { data } = await http.get("/plinko/history", { params: { limit: 10 } });
            setHistory(data?.rows || []);
        } catch (_) {}
    }, []);
    useEffect(() => { refreshHistory(); }, [refreshHistory]);

    const buckets = config?.multiplier_tables?.[`${rows}_${risk}`] || [];
    const betNum = parseFloat(bet) || 0;
    const cantDrop = dropping || betNum <= 0 || betNum > (balance ?? 0);

    const drop = useCallback(async () => {
        if (cantDrop) {
            notifyError();
            toast.error(betNum > (balance ?? 0) ? "Not enough TON." : "Enter a bet.");
            return;
        }
        setDropping(true);
        tapMedium();
        sfx.play("chip_click", { volume: 0.4 });
        try {
            const { data } = await http.post("/plinko/bet", { bet_ton: betNum, rows, risk });
            setLastResult(data);
            tapHeavy();
            if (data.payout_ton >= betNum) {
                notifySuccess();
                sfx.play("success_bell", { volume: 0.45 });
                if (data.multiplier >= 5) sfx.play("confetti_burst", { volume: 0.5 });
                // Phase 11.1 — gold burst on big-win cashouts
                if (data.multiplier >= 50)      fireLegendaryBurst({ intensity: "epic" });
                else if (data.multiplier >= 10) fireLegendaryBurst({ intensity: "normal" });
                toast.success(`Landed bucket #${data.final_bucket} · ${data.multiplier}× · won ${formatTON(data.payout_ton)} TON`);
            } else {
                sfx.play("loss_thud", { volume: 0.4 });
                toast(`Landed bucket #${data.final_bucket} · ${data.multiplier}×`);
            }
            refreshBalance?.();
            await refreshHistory();
        } catch (e) {
            notifyError();
            const detail = e?.response?.data?.detail || "drop_failed";
            toast.error(`Plinko drop failed: ${detail}`);
        } finally {
            setDropping(false);
        }
    }, [cantDrop, betNum, balance, rows, risk, refreshBalance, refreshHistory]);

    if (!user) {
        return (
            <main className="p-6 text-center text-white/60" data-testid="plinko-page">
                Sign in to play Plinko.
            </main>
        );
    }

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-3xl mx-auto w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="plinko-page"
        >
            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: PRM() ? 0 : 0.3 }}
                className="relative rounded-2xl border border-gold-500/30 overflow-hidden"
                style={{
                    minHeight: 140,
                    background: "linear-gradient(90deg, rgba(15,12,5,0.95) 0%, rgba(15,12,5,0.55) 60%, rgba(15,12,5,0.05) 100%), radial-gradient(circle at 80% 50%, rgba(255,215,0,0.22), transparent 60%), #0b0905",
                }}
                data-testid="plinko-hero"
            >
                <div className="p-4 sm:p-5 max-w-md">
                    <div className="flex items-center gap-2 mb-1.5">
                        <CircleDot className="w-4 h-4 text-gold-bright" />
                        <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-gold-bright/90">
                            Provably fair · RTP ≈ 0.95–0.99
                        </span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Plinko</h1>
                    <p className="text-sm text-white/70 mt-1">
                        Drop the ball. Multiplier scales with the edge — risk = reward.
                    </p>
                </div>
            </motion.div>

            {/* Bet controls */}
            <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3 space-y-3" data-testid="plinko-controls">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">Rows</label>
                        <div className="flex gap-1.5">
                            {(config?.rows_allowed || [8, 12, 16]).map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => { setRows(r); tapMedium(); }}
                                    className={`flex-1 py-1.5 rounded-md text-sm font-semibold border transition-colors ${
                                        r === rows
                                            ? "bg-gold-bright/20 border-gold-bright/55 text-gold-bright"
                                            : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                                    }`}
                                    data-testid={`plinko-rows-${r}`}
                                >{r}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">Risk</label>
                        <div className="flex gap-1.5">
                            {["low", "medium", "high"].map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => { setRisk(r); tapMedium(); }}
                                    className={`flex-1 py-1.5 rounded-md text-[11px] uppercase font-semibold border transition-colors ${
                                        r === risk
                                            ? "bg-gold-500/20 border-gold-500/55 text-gold-200"
                                            : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                                    }`}
                                    data-testid={`plinko-risk-${r}`}
                                >{r}</button>
                            ))}
                        </div>
                    </div>
                </div>
                <div>
                    <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">Bet (TON)</label>
                    <input
                        type="number" step="0.1" min="0.1" max="100"
                        value={bet}
                        onChange={(e) => setBet(e.target.value)}
                        inputMode="decimal"
                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono"
                        data-testid="plinko-bet-input"
                    />
                </div>
                <button
                    type="button"
                    onClick={drop}
                    disabled={cantDrop}
                    className="w-full py-3 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 font-bold text-sm hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_8px_24px_-6px_rgba(212,175,55,0.45)]"
                    data-testid="plinko-drop-btn"
                >
                    {dropping ? <><Loader2 className="w-4 h-4 animate-spin" /> Dropping…</>
                        : <><CircleDot className="w-4 h-4" /> Drop ball — {bet} TON</>}
                </button>
            </section>

            {/* Bucket strip */}
            <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3" data-testid="plinko-buckets">
                <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-2">Multipliers</div>
                <div className="flex gap-1 overflow-x-auto">
                    {buckets.map((m, i) => (
                        <motion.div
                            key={i}
                            initial={false}
                            animate={lastResult?.final_bucket === i ? { scale: [1, 1.18, 1] } : {}}
                            transition={{ duration: 0.6 }}
                            className={`shrink-0 min-w-[42px] py-2 px-1 rounded-md text-center text-[11px] font-bold font-mono border ${bucketColor(m)} ${
                                lastResult?.final_bucket === i ? "ring-2 ring-white/70" : ""
                            }`}
                            data-testid={`plinko-bucket-${i}`}
                        >
                            {m}×
                        </motion.div>
                    ))}
                </div>
                <AnimatePresence>
                    {lastResult && (
                        <motion.div
                            key={lastResult.bet_id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="mt-3 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm flex items-center gap-2"
                            data-testid="plinko-last-result"
                        >
                            <span className="text-white/55">Bucket #{lastResult.final_bucket}</span>
                            <span className="font-bold text-white">{lastResult.multiplier}×</span>
                            <span className="ml-auto font-mono text-gold-bright">+{formatTON(lastResult.payout_ton)} TON</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </section>

            {/* History */}
            <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3" data-testid="plinko-history">
                <div className="flex items-center gap-2 mb-2">
                    <History className="w-3.5 h-3.5 text-white/45" />
                    <span className="text-[10px] uppercase tracking-widest text-white/45 font-bold">History</span>
                </div>
                {history.length === 0 && (
                    <p className="text-sm text-white/45 py-4 text-center" data-testid="plinko-history-empty">No drops yet.</p>
                )}
                {history.map((h) => (
                    <div key={h.bet_id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/8 mb-1">
                        <span className="text-white/55 tabular-nums">#{h.final_bucket}</span>
                        <span className="font-mono text-white/80">{h.multiplier}×</span>
                        <span className="ml-auto font-mono text-gold-bright">{formatTON(h.payout_ton)}</span>
                        <code className="hidden sm:inline text-[9px] font-mono text-white/35">
                            {(h.server_seed_hash || "").slice(0, 6)}…
                        </code>
                        <a
                            href={`#verify-${h.bet_id}`}
                            onClick={(e) => { e.preventDefault(); setVerifyBet(h); tapMedium(); }}
                            className="text-[9px] font-bold text-gold-bright/85 hover:text-gold-bright cursor-pointer"
                            data-testid={`plinko-history-verify-${h.bet_id}`}
                        >
                            <Shield className="inline w-2.5 h-2.5 mr-0.5" /> VERIFY
                        </a>
                    </div>
                ))}
            </section>

            {/* Fix-D: provably-fair modal */}
            <FairnessModal
                open={fairnessOpen}
                onClose={() => setVerifyBet(null)}
                title="Verify this drop"
                subtitle="Recompute the ball path from the server seed to confirm the bucket was not rigged."
                fields={verifyBet ? [
                    { label: "Bet ID", value: verifyBet.bet_id, copyable: true },
                    { label: "Server seed hash (committed pre-drop)", value: verifyBet.server_seed_hash, copyable: true },
                    { label: "Client seed", value: verifyBet.client_seed || verifyBet.bet_id, copyable: true },
                    { label: "Nonce", value: "0", mono: true },
                    { label: "Rows · Risk", value: `${verifyBet.rows} · ${verifyBet.risk}`, mono: true },
                    { label: "Final bucket", value: String(verifyBet.final_bucket ?? "—"), mono: true },
                    { label: "Multiplier", value: `${verifyBet.multiplier}×`, mono: true },
                    {
                        label: "Path (L=0, R=1)",
                        value: verifyBet.path ? verifyBet.path.join(" ") : "—",
                    },
                ] : []}
                verifyUrl={verifyBet ? `/plinko/bets/${verifyBet.bet_id}/verify` : null}
                parseVerify={(r) => ([
                    { label: "Hash matches commit",   ok: !!r.server_seed_hash_matches },
                    { label: "Bucket recomputed OK",  ok: !!r.bucket_matches },
                    { label: "Multiplier matches",    ok: !!r.multiplier_matches },
                ])}
                revealedFields={(r) => ([
                    { label: "Server seed (revealed post-drop)", value: r.server_seed, copyable: true },
                    { label: "Recomputed path", value: (r.recomputed_path || []).join(" "), mono: true },
                ])}
            />
        </main>
    );
}
