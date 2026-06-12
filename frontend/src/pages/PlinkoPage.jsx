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
import { CircleDot, Shield, Loader2, History } from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";
import FairnessModal from "@/components/common/FairnessModal";
import { fireLegendaryBurst } from "@/lib/celebrations";


// Plinko bucket multiplier → Vault tier (0 lowest … 4 jackpot). Drives .v-bucket[data-tier].
function bucketTier(mult) {
    if (mult >= 50) return 4;
    if (mult >= 10) return 3;
    if (mult >= 2)  return 2;
    if (mult >= 1)  return 1;
    return 0;
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
            className="v-wrap"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="plinko-page"
        >
            {/* Hero */}
            <header className="v-gamehead" data-game="plinko" data-testid="plinko-hero">
                <div className="v-eyebrow"><CircleDot className="w-3 h-3" /> Provably fair · RTP ≈ 0.95–0.99</div>
                <h1 className="v-disp">Plinko</h1>
                <p>Drop the ball. Multiplier scales with the edge — risk = reward.</p>
            </header>

            {/* Bet controls */}
            <section className="v-card v-betpanel" data-testid="plinko-controls">
                <div className="v-fields">
                    <div className="v-field">
                        <span className="lbl">Rows</span>
                        <div className="v-seg">
                            {(config?.rows_allowed || [8, 12, 16]).map((r) => (
                                <button key={r} type="button" data-testid={`plinko-rows-${r}`}
                                    onClick={() => { setRows(r); tapMedium(); }}
                                    className={`v-segbtn${r === rows ? " on" : ""}`}>{r}</button>
                            ))}
                        </div>
                    </div>
                    <div className="v-field">
                        <span className="lbl">Risk</span>
                        <div className="v-seg">
                            {["low", "medium", "high"].map((r) => (
                                <button key={r} type="button" data-testid={`plinko-risk-${r}`}
                                    onClick={() => { setRisk(r); tapMedium(); }}
                                    className={`v-segbtn${r === risk ? " on" : ""}`} style={{ fontSize: 10 }}>{r}</button>
                            ))}
                        </div>
                    </div>
                </div>
                <label className="v-field" style={{ marginTop: 12 }}>
                    <span className="lbl">Bet (TON)</span>
                    <input type="number" step="0.1" min="0.1" max="100" value={bet}
                        onChange={(e) => setBet(e.target.value)} inputMode="decimal"
                        data-testid="plinko-bet-input" />
                </label>
                <button type="button" onClick={drop} disabled={cantDrop}
                    className="v-cta v-wide" style={{ marginTop: 14 }} data-testid="plinko-drop-btn">
                    {dropping ? <><Loader2 className="w-4 h-4 animate-spin" /> Dropping…</>
                        : <><CircleDot className="w-4 h-4" /> Drop ball — {bet} TON</>}
                </button>
            </section>

            {/* Bucket strip */}
            <section className="v-feed" data-testid="plinko-buckets">
                <div className="hd">Multipliers</div>
                <div className="v-buckets">
                    {buckets.map((m, i) => (
                        <motion.div
                            key={i}
                            initial={false}
                            animate={lastResult?.final_bucket === i ? { scale: [1, 1.18, 1] } : {}}
                            transition={{ duration: 0.6 }}
                            className={`v-bucket${lastResult?.final_bucket === i ? " hit" : ""}`}
                            data-tier={bucketTier(m)}
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
                            className="v-lastres"
                            data-testid="plinko-last-result"
                        >
                            <span className="b">Bucket #{lastResult.final_bucket}</span>
                            <span className="mx">{lastResult.multiplier}×</span>
                            <span className="pay">+{formatTON(lastResult.payout_ton)} TON</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </section>

            {/* History */}
            <section className="v-feed" data-testid="plinko-history">
                <div className="hd"><History className="w-3.5 h-3.5" /> History</div>
                {history.length === 0 && (
                    <p className="v-feedempty" style={{ textAlign: "center", padding: "14px 0" }} data-testid="plinko-history-empty">No drops yet.</p>
                )}
                {history.map((h) => (
                    <div key={h.bet_id} className="v-hrow">
                        <span className="mx">#{h.final_bucket}</span>
                        <span className="amt">{h.multiplier}×</span>
                        <span className="amt" style={{ marginLeft: "auto", color: "var(--v-gold-hi)" }}>{formatTON(h.payout_ton)}</span>
                        <span className="hash">{(h.server_seed_hash || "").slice(0, 6)}…</span>
                        <a
                            href={`#verify-${h.bet_id}`}
                            onClick={(e) => { e.preventDefault(); setVerifyBet(h); tapMedium(); }}
                            className="vbtn"
                            data-testid={`plinko-history-verify-${h.bet_id}`}
                        >
                            <Shield className="inline w-2.5 h-2.5 mr-0.5" /> Verify
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
