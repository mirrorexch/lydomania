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
            className="v-wrap"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="mines-page"
        >
            <header className="v-gamehead" data-game="mines" data-testid="mines-hero">
                <div className="v-eyebrow"><Bomb className="w-3 h-3" /> Provably fair</div>
                <h1 className="v-disp">Mines</h1>
                <p>Reveal safe cells. Cash out before you hit a bomb.</p>
            </header>

            {!game && (
                <section className="v-card v-betpanel" data-testid="mines-controls">
                    <div className="v-fields">
                        <label className="v-field">
                            <span className="lbl">Bet (TON)</span>
                            <input type="number" step="0.1" min="0.1" max="100" value={bet} onChange={(e) => setBet(e.target.value)}
                                inputMode="decimal" data-testid="mines-bet-input"
                            />
                        </label>
                        <label className="v-field">
                            <span className="lbl">Mines · {minesCount}</span>
                            <input type="range" min="1" max="24" value={minesCount}
                                onChange={(e) => setMinesCount(parseInt(e.target.value))}
                                className="v-range" data-testid="mines-count-slider"
                            />
                        </label>
                    </div>
                    <button type="button" onClick={start} disabled={busy} className="v-cta v-wide" data-testid="mines-start-btn">
                        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Bomb className="w-4 h-4" /> Start round</>}
                    </button>
                </section>
            )}

            {game && (
                <section className="v-card v-betpanel" data-testid="mines-grid-section">
                    <div className="v-minetop">
                        <div className="meta"><span className="v-muted">Mines</span> <b>{game.mines_count}</b> · <span className="v-muted">Bet</span> <b>{formatTON(game.bet_ton)}</b> TON</div>
                        <div className="v-mult" data-testid="mines-current-mult">{mult}×</div>
                    </div>
                    <div className="v-minesgrid" data-testid="mines-grid">
                        {Array.from({ length: 25 }, (_, i) => i).map((cell) => {
                            const isRevealed = revealed.includes(cell);
                            return (
                                <motion.button
                                    key={cell}
                                    type="button"
                                    whileTap={PRM() ? {} : { scale: 0.9 }}
                                    disabled={isRevealed || busy}
                                    onClick={() => reveal(cell)}
                                    className={`v-mcell${isRevealed ? " on" : ""}`}
                                    data-testid={`mines-cell-${cell}`}
                                >
                                    {isRevealed ? <Gem className="w-4 h-4" /> : ""}
                                </motion.button>
                            );
                        })}
                    </div>
                    <button type="button" onClick={cashout} disabled={busy || revealed.length === 0}
                        className="v-cta v-wide" data-testid="mines-cashout-btn">
                        <Wallet className="w-4 h-4" /> Cashout · {formatTON(game.bet_ton * mult)} TON
                    </button>
                </section>
            )}

            {outcome && (
                <motion.section
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className={`v-outcome ${outcome.hit_mine ? "boom" : "win"}`}
                    data-testid="mines-outcome"
                >
                    <div className="top">
                        {outcome.hit_mine ? <X className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
                        <span>{outcome.hit_mine ? "Boom — better luck next time" : `Cashed out · ${formatTON(outcome.payout_ton)} TON`}</span>
                        <button
                            type="button"
                            onClick={() => setVerifyGame({
                                game_id: outcome.game_id, server_seed_hash: outcome.server_seed_hash,
                                server_seed: outcome.server_seed, client_seed: outcome.client_seed,
                                mines: outcome.mines, mines_count: outcome.mines_count,
                                bet_ton: outcome.bet_ton, multiplier: outcome.multiplier ?? mult,
                                revealed_count: outcome.revealed_count ?? revealed.length,
                            })}
                            className="v-verify"
                            data-testid="mines-outcome-verify-btn"
                        >
                            <Shield className="w-3 h-3" /> Verify
                        </button>
                    </div>
                    <div className="mines">Mines: [{outcome.mines.join(", ")}]</div>
                </motion.section>
            )}

            {/* History with VERIFY chips */}
            <section className="v-feed" data-testid="mines-history">
                <div className="hd"><History className="w-3.5 h-3.5" /> History</div>
                {history.length === 0 && (
                    <p className="v-feedempty" style={{ textAlign: "center", padding: "14px 0" }} data-testid="mines-history-empty">No previous games.</p>
                )}
                {history.map((h) => (
                    <div key={h.game_id} className="v-hrow" data-testid={`mines-history-row-${h.game_id}`}>
                        <span className={`tag ${h.status === "cashed_out" ? "win" : "bust"}`}>
                            {h.status === "cashed_out" ? "WIN" : "BUST"}
                        </span>
                        <span className="amt">{formatTON(h.bet_ton)}→{formatTON(h.payout_ton || 0)} TON</span>
                        <span className="mx">×{h.current_multiplier ?? 1.0}</span>
                        <span className="hash">{(h.server_seed_hash || "").slice(0, 6)}…</span>
                        <button
                            type="button"
                            onClick={() => { setVerifyGame(h); tapMedium(); }}
                            className="vbtn"
                            data-testid={`mines-history-verify-${h.game_id}`}
                        >
                            <Shield className="w-2.5 h-2.5" /> Verify
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
