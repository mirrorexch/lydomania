/**
 * Phase 8 — Mines page. 5×5 grid with start/reveal/cashout flow.
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bomb, Coins, Shield, Loader2, X, Gem, Wallet, History } from "lucide-react";
import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";
import FairnessModal from "@/components/common/FairnessModal";
import { fireLegendaryBurst } from "@/lib/celebrations";

const PRM = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Small 5x5 grid render — mines highlighted in red, others muted.
function MinesGridPreview({ mines, gridSize = 25 }) {
    const set = new Set((mines || []).map((x) => parseInt(x)));
    return (
        <div className="grid grid-cols-5 gap-1" data-testid="fairness-mines-grid">
            {Array.from({ length: gridSize }, (_, i) => (
                <div
                    key={i}
                    className={`aspect-square rounded text-[10px] flex items-center justify-center font-mono ${
                        set.has(i)
                            ? "bg-rose-500/30 border border-rose-400/50 text-rose-100"
                            : "bg-emerald-500/10 border border-emerald-400/30 text-emerald-200"
                    }`}
                >
                    {set.has(i) ? "✕" : i}
                </div>
            ))}
        </div>
    );
}

export default function MinesPage({ user, balance, refreshBalance }) {
    const [game, setGame] = useState(null);
    const [bet, setBet] = useState("1");
    const [minesCount, setMinesCount] = useState(3);
    const [revealed, setRevealed] = useState([]);
    const [mult, setMult] = useState(1.0);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState(null);
    // Fix-E: history + fairness modal state
    const [history, setHistory] = useState([]);
    const [verifyGame, setVerifyGame] = useState(null);
    const fairnessOpen = !!verifyGame;

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const { data } = await http.get("/mines/active");
                if (data?.game) {
                    setGame(data.game);
                    setRevealed(data.game.revealed || []);
                    setMult(data.game.current_multiplier || 1.0);
                }
            } catch (_) {}
            try {
                const { data } = await http.get("/mines/history", { params: { limit: 10 } });
                setHistory(data?.rows || []);
            } catch (_) {}
        })();
    }, [user]);

    const refreshHistory = useCallback(async () => {
        try {
            const { data } = await http.get("/mines/history", { params: { limit: 10 } });
            setHistory(data?.rows || []);
        } catch (_) {}
    }, []);

    const start = useCallback(async () => {
        const bn = parseFloat(bet) || 0;
        if (bn <= 0 || bn > (balance ?? 0)) {
            notifyError(); toast.error("Enter a valid bet.");
            return;
        }
        setBusy(true); tapMedium();
        try {
            const { data } = await http.post("/mines/start", { bet_ton: bn, mines_count: minesCount });
            setGame(data); setRevealed([]); setMult(1.0); setOutcome(null);
            refreshBalance?.();
            sfx.play("case_lock_thunk", { volume: 0.4 });
        } catch (e) {
            notifyError();
            toast.error(`Couldn't start: ${e?.response?.data?.detail || "error"}`);
        } finally { setBusy(false); }
    }, [bet, minesCount, balance, refreshBalance]);

    const reveal = useCallback(async (cell) => {
        if (!game || busy || revealed.includes(cell)) return;
        setBusy(true); tapMedium();
        try {
            const { data } = await http.post("/mines/reveal", { game_id: game.game_id, cell });
            if (data.hit_mine) {
                sfx.play("loss_thud", { volume: 0.55 }); tapHeavy(); notifyError();
                setOutcome({
                    hit_mine: true, mines: data.mines, payout_ton: 0,
                    server_seed: data.server_seed, server_seed_hash: data.server_seed_hash,
                    client_seed: data.client_seed, game_id: game.game_id,
                    mines_count: game.mines_count, bet_ton: game.bet_ton,
                    multiplier: 0, revealed_count: revealed.length, cell: data.cell,
                });
                setGame(null); setRevealed([]); setMult(1.0);
                refreshBalance?.();
                refreshHistory();
                toast.error("💥 Boom! You hit a mine.");
            } else {
                sfx.play("scroll_tick", { volume: 0.4 });
                setRevealed((p) => [...p, cell]);
                setMult(data.current_multiplier);
            }
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "reveal_failed");
        } finally { setBusy(false); }
    }, [game, busy, revealed, refreshBalance]);

    const cashout = useCallback(async () => {
        if (!game || busy || revealed.length === 0) return;
        setBusy(true); tapHeavy();
        try {
            const { data } = await http.post("/mines/cashout", { game_id: game.game_id });
            // Phase 11.1 — gold burst on big-win cashouts (≥5x normal, ≥10x epic)
            if (data?.multiplier >= 10)     fireLegendaryBurst({ intensity: "epic" });
            else if (data?.multiplier >= 5) fireLegendaryBurst({ intensity: "normal" });
            setOutcome({
                hit_mine: false, mines: data.mines, payout_ton: data.payout_ton,
                server_seed: data.server_seed, server_seed_hash: data.server_seed_hash,
                client_seed: data.client_seed, game_id: data.game_id,
                multiplier: data.multiplier, mines_count: game.mines_count,
                bet_ton: game.bet_ton, revealed_count: revealed.length,
            });
            sfx.play("success_bell", { volume: 0.5 });
            sfx.play("confetti_burst", { volume: 0.5 });
            notifySuccess();
            toast.success(`Cashed out ${formatTON(data.payout_ton)} TON · ${mult}×`);
            setGame(null); setRevealed([]); setMult(1.0);
            refreshBalance?.();
            refreshHistory();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "cashout_failed");
        } finally { setBusy(false); }
    }, [game, busy, revealed, mult, refreshBalance]);

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-2xl mx-auto w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="mines-page"
        >
            <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: PRM() ? 0 : 0.3 }}
                className="relative rounded-2xl border border-gold-500/30 overflow-hidden p-4"
                style={{
                    minHeight: 130,
                    background: "linear-gradient(120deg, rgba(20,12,5,0.95) 0%, rgba(20,12,5,0.5) 100%), radial-gradient(circle at 90% 50%, rgba(255,215,0,0.18), transparent 60%), radial-gradient(circle at 88% 30%, rgba(244,63,94,0.14), transparent 50%), #0b0905",
                }}
                data-testid="mines-hero"
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <Bomb className="w-4 h-4 text-rose-300" />
                    <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-rose-300/90">Provably fair</span>
                </div>
                <h1 className="text-2xl font-bold text-white">Mines</h1>
                <p className="text-sm text-white/70 mt-1">Reveal safe cells. Cashout before you hit a bomb.</p>
            </motion.div>

            {!game && (
                <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3 space-y-3" data-testid="mines-controls">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">Bet (TON)</label>
                            <input type="number" step="0.1" min="0.1" max="100" value={bet} onChange={(e) => setBet(e.target.value)}
                                inputMode="decimal"
                                className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono"
                                data-testid="mines-bet-input"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">Mines · {minesCount}</label>
                            <input type="range" min="1" max="24" value={minesCount}
                                onChange={(e) => setMinesCount(parseInt(e.target.value))}
                                className="w-full accent-rose-400"
                                data-testid="mines-count-slider"
                            />
                        </div>
                    </div>
                    <button type="button" onClick={start} disabled={busy}
                        className="w-full py-3 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 hover:brightness-110 text-zinc-950 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 shadow-[0_8px_24px_-6px_rgba(212,175,55,0.55)]"
                        data-testid="mines-start-btn"
                    >
                        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Bomb className="w-4 h-4" /> Start round</>}
                    </button>
                </section>
            )}

            {game && (
                <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3" data-testid="mines-grid-section">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[11px] font-mono text-white/55">
                            <span className="text-white/45">Mines:</span> {game.mines_count} · <span className="text-white/45">Bet:</span> {formatTON(game.bet_ton)} TON
                        </div>
                        <div className="font-luxe text-2xl font-bold text-gold-bright tabular-nums leading-none drop-shadow-[0_0_10px_rgba(255,215,0,0.45)]" data-testid="mines-current-mult">{mult}×</div>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 mb-3" data-testid="mines-grid">
                        {Array.from({ length: 25 }, (_, i) => i).map((cell) => {
                            const isRevealed = revealed.includes(cell);
                            return (
                                <motion.button
                                    key={cell}
                                    type="button"
                                    whileTap={PRM() ? {} : { scale: 0.9 }}
                                    disabled={isRevealed || busy}
                                    onClick={() => reveal(cell)}
                                    className={`aspect-square rounded-md border text-sm font-bold flex items-center justify-center transition-all ${
                                        isRevealed
                                            ? "bg-gold-bright/15 border-gold-bright/55 text-gold-bright shadow-[0_0_12px_-2px_rgba(255,215,0,0.55)]"
                                            : "bg-[var(--surface-2)] border-gold-500/15 text-gold-200/40 hover:border-gold-500/40 hover:text-gold-200"
                                    }`}
                                    data-testid={`mines-cell-${cell}`}
                                >
                                    {isRevealed ? <Gem className="w-4 h-4" /> : ""}
                                </motion.button>
                            );
                        })}
                    </div>
                    <button type="button" onClick={cashout} disabled={busy || revealed.length === 0}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 font-bold text-sm hover:brightness-110 transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-[0_8px_24px_-6px_rgba(212,175,55,0.45)]"
                        data-testid="mines-cashout-btn"
                    >
                        <Wallet className="w-4 h-4" /> Cashout · {formatTON(game.bet_ton * mult)} TON
                    </button>
                </section>
            )}

            {outcome && (
                <motion.section
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl bg-zinc-900/70 border border-white/10 p-3"
                    data-testid="mines-outcome"
                >
                    <div className={`flex items-center gap-2 mb-2 ${outcome.hit_mine ? "text-rose-300" : "text-emerald-300"}`}>
                        {outcome.hit_mine ? <X className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
                        <span className="text-sm font-bold">
                            {outcome.hit_mine ? "Boom — better luck next time" : `Cashed out · ${formatTON(outcome.payout_ton)} TON`}
                        </span>
                        <button
                            type="button"
                            onClick={() => setVerifyGame({
                                game_id: outcome.game_id, server_seed_hash: outcome.server_seed_hash,
                                server_seed: outcome.server_seed, client_seed: outcome.client_seed,
                                mines: outcome.mines, mines_count: outcome.mines_count,
                                bet_ton: outcome.bet_ton, multiplier: outcome.multiplier ?? mult,
                                revealed_count: outcome.revealed_count ?? revealed.length,
                            })}
                            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded bg-gold-bright/15 border border-gold-bright/45 text-gold-bright text-[10px] font-bold uppercase tracking-wider hover:bg-gold-bright/25 transition-colors"
                            data-testid="mines-outcome-verify-btn"
                        >
                            <Shield className="w-3 h-3" /> Verify
                        </button>
                    </div>
                    <div className="text-[11px] text-white/55 font-mono">
                        Mines: [{outcome.mines.join(", ")}]
                    </div>
                </motion.section>
            )}

            {/* Fix-E: History section with VERIFY chips */}
            <section className="rounded-xl bg-zinc-900/70 border border-white/10 p-3" data-testid="mines-history">
                <div className="flex items-center gap-2 mb-2">
                    <History className="w-3.5 h-3.5 text-white/45" />
                    <span className="text-[10px] uppercase tracking-widest text-white/45 font-bold">History</span>
                </div>
                {history.length === 0 && (
                    <p className="text-sm text-white/45 py-4 text-center" data-testid="mines-history-empty">No previous games.</p>
                )}
                {history.map((h) => (
                    <div key={h.game_id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/8 mb-1" data-testid={`mines-history-row-${h.game_id}`}>
                        <span className={`text-[10px] uppercase font-bold tabular-nums ${
                            h.status === "cashed_out" ? "text-emerald-300" : "text-rose-300"
                        }`}>
                            {h.status === "cashed_out" ? "WIN" : "BUST"}
                        </span>
                        <span className="font-mono text-white/80">{formatTON(h.bet_ton)}→{formatTON(h.payout_ton || 0)} TON</span>
                        <span className="text-[10px] text-white/45 tabular-nums">×{h.current_multiplier ?? 1.0}</span>
                        <span className="ml-auto text-[9px] font-mono text-white/35">
                            {(h.server_seed_hash || "").slice(0, 6)}…
                        </span>
                        <button
                            type="button"
                            onClick={() => { setVerifyGame(h); tapMedium(); }}
                            className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-gold-bright/85 hover:text-gold-bright px-1.5 py-0.5 rounded hover:bg-gold-bright/10"
                            data-testid={`mines-history-verify-${h.game_id}`}
                        >
                            <Shield className="w-2.5 h-2.5" /> VERIFY
                        </button>
                    </div>
                ))}
            </section>

            {/* Fix-E: provably-fair modal */}
            <FairnessModal
                open={fairnessOpen}
                onClose={() => setVerifyGame(null)}
                title="Verify this game"
                subtitle="Recompute the mine layout from the server seed (revealed below) to confirm the placement wasn't tampered with."
                fields={verifyGame ? [
                    { label: "Game ID", value: verifyGame.game_id, copyable: true },
                    { label: "Server seed hash (committed pre-start)", value: verifyGame.server_seed_hash, copyable: true },
                    { label: "Client seed", value: verifyGame.client_seed || verifyGame.game_id, copyable: true },
                    { label: "Nonce", value: "0", mono: true },
                    { label: "Mines count", value: String(verifyGame.mines_count ?? "—"), mono: true },
                    { label: "Safe cells revealed",
                      value: String(verifyGame.revealed_count ?? (verifyGame.revealed?.length ?? "—")), mono: true },
                    { label: "Final multiplier",
                      value: `${verifyGame.current_multiplier ?? verifyGame.multiplier ?? 1.0}×`, mono: true },
                    {
                        label: "Mine layout (claimed)",
                        value: verifyGame.mines || [],
                        render: (val) => <MinesGridPreview mines={val} />,
                    },
                ] : []}
                verifyUrl={verifyGame ? `/mines/games/${verifyGame.game_id}/verify` : null}
                parseVerify={(r) => ([
                    { label: "Hash matches commit", ok: !!r.server_seed_hash_matches },
                    { label: "Layout matches",      ok: !!r.layout_matches },
                ])}
                revealedFields={(r) => ([
                    { label: "Server seed (revealed post-game)", value: r.server_seed, copyable: true },
                    {
                        label: "Recomputed mine layout",
                        value: r.recomputed_mines || [],
                        render: (val) => <MinesGridPreview mines={val} />,
                    },
                ])}
            />
        </main>
    );
}
