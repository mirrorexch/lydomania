/**
 * Phase 6d — Battle Arena page.
 *
 * Multi-pane view: one pane per seat, each shows running total + reel
 * animation for the current round + the row of revealed items.
 *
 * State source = openBattleSocket(battleId) → onMessage events:
 *   snapshot, status, countdown, seat_joined, seat_left, round_reveal,
 *   completed, cancelled.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Shield, Trophy, Loader2, Swords, X } from "lucide-react";

import { http, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifySuccess, notifyError } from "@/lib/haptics";
import { openBattleSocket } from "@/lib/battlesWs";


const ITEM_PX = 78;
const REEL_REPEATS = 14;          // 14 × basket size cells in the reel
const REEL_LAND_REPEAT = 10;      // land near end


export default function BattleArenaPage({ user, refreshBalance }) {
    const { t } = useTranslation();
    const { battleId } = useParams();
    const navigate = useNavigate();
    const [battle, setBattle] = useState(null);
    const [countdown, setCountdown] = useState(null);
    const [revealsBySeat, setRevealsBySeat] = useState({}); // seat_idx → array of {round_idx, item}
    const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
    const [activeReveal, setActiveReveal] = useState(null); // {round_idx, picks, case_slug}
    const [showVerifier, setShowVerifier] = useState(false);
    const [verify, setVerify] = useState(null);

    // WS connection
    useEffect(() => {
        const conn = openBattleSocket(battleId, {
            onMessage: (msg) => {
                if (msg.type === "snapshot") {
                    setBattle(msg.battle);
                    const byseat = {};
                    for (const s of msg.battle.seats) {
                        byseat[s.seat_index] = s.rounds || [];
                    }
                    setRevealsBySeat(byseat);
                    setCurrentRoundIdx(msg.battle.current_round_idx || 0);
                } else if (msg.type === "status") {
                    setBattle((prev) => prev ? { ...prev, status: msg.status } : prev);
                } else if (msg.type === "countdown") {
                    setCountdown({ ends_at: msg.ready_at, sec: msg.countdown_sec });
                } else if (msg.type === "seat_joined" || msg.type === "seat_left") {
                    setBattle(msg.battle);
                } else if (msg.type === "round_reveal") {
                    setActiveReveal(msg);
                    setCurrentRoundIdx(msg.round_idx + 1);
                    tapMedium();
                    sfx.play("scroll_tick", { volume: 0.45 });
                    // After reveal duration, commit reveals into per-seat array
                    setTimeout(() => {
                        setRevealsBySeat((prev) => {
                            const out = { ...prev };
                            for (const p of msg.picks) {
                                out[p.seat_index] = [...(out[p.seat_index] || []), {
                                    round_idx: msg.round_idx,
                                    item_slug: p.slug,
                                    payout_ton: p.payout_ton,
                                    item: p.item,
                                }];
                            }
                            return out;
                        });
                    }, (msg.reveal_duration_sec * 1000) - 200);
                } else if (msg.type === "completed") {
                    setBattle(msg.battle);
                    tapHeavy();
                    notifySuccess();
                    sfx.play("win_legendary", { volume: 0.8 });
                    if (refreshBalance) refreshBalance();
                } else if (msg.type === "cancelled") {
                    setBattle(msg.battle);
                    notifyError();
                    toast.error(t("battles.toast.cancelled"));
                }
            },
        });
        return () => conn.close();
    }, [battleId, refreshBalance, t]);

    // Per-second countdown tick
    useEffect(() => {
        if (battle?.status !== "ready" || !battle?.ready_at) return;
        const id = setInterval(() => {
            const ms = new Date(battle.ready_at).getTime() + 5000 - Date.now();
            if (ms <= 0) clearInterval(id);
            setCountdown({ secLeft: Math.max(0, Math.ceil(ms / 1000)) });
        }, 200);
        return () => clearInterval(id);
    }, [battle?.status, battle?.ready_at]);

    const leave = useCallback(async () => {
        try {
            tapMedium();
            await http.post(`/battles/${battleId}/leave`);
            if (refreshBalance) refreshBalance();
            notifySuccess();
            toast.success(t("battles.toast.left"));
            navigate("/battles");
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "leave failed");
        }
    }, [battleId, navigate, refreshBalance, t]);

    const openVerifier = useCallback(async () => {
        setShowVerifier(true);
        try {
            const { data } = await http.get(`/battles/${battleId}/verify`);
            setVerify(data);
        } catch (e) {
            toast.error("verifier not ready");
            setShowVerifier(false);
        }
    }, [battleId]);

    if (!battle) {
        return (
            <main className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-white/40" />
            </main>
        );
    }

    const seats = battle.seats || [];
    const filledSeats = seats.filter((s) => s.user_id);
    const isMine = seats.some((s) => s.user_id === user?.id);
    const canLeave = battle.status === "open" && isMine;
    const totalRounds = battle.case_sequence?.length || 0;

    return (
        <main className="mx-auto px-3 sm:px-6 pt-3 pb-24 lg:pb-6 space-y-4 max-w-[430px] sm:max-w-[900px] lg:max-w-[1300px]"
              data-testid="battle-arena-page">

            <header className="flex items-center justify-between gap-2 sticky top-[52px] lg:top-0 z-20 -mx-1 px-1 py-2 bg-cyber-bg/90 backdrop-blur-xl">
                <Link to="/battles" className="text-white/70 hover:text-white flex items-center gap-1">
                    <ArrowLeft className="w-4 h-4" /><span className="text-xs">{t("battles.lobby_short")}</span>
                </Link>
                <div className="text-center">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-gold-bright font-bold flex items-center justify-center gap-1">
                        <Swords className="w-3 h-3" />{t(`battles.mode.${battle.mode}`)}
                    </div>
                    <div data-testid="battle-status" className="text-sm font-display font-extrabold">
                        {t(`battles.status.${battle.status}`)}
                        {battle.status === "rolling" && (
                            <span className="ml-2 text-gold-bright">
                                {t("battles.round_x_of_n", { x: Math.min(currentRoundIdx + 1, totalRounds), n: totalRounds })}
                            </span>
                        )}
                        {battle.status === "ready" && countdown && (
                            <span className="ml-2 text-gold-300 tabular-nums">{countdown.secLeft}s</span>
                        )}
                    </div>
                </div>
                <button onClick={openVerifier} data-testid="battle-pf-btn"
                    className="text-[10px] flex items-center gap-1 bg-white/[0.04] border border-white/10 rounded-full px-2 py-1">
                    <Shield className="w-3 h-3 text-gold-bright" />{t("battles.pf_short")}
                </button>
            </header>

            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4"
                 style={{ gridTemplateColumns: battle.players >= 3 ? undefined : "1fr 1fr" }}
                 data-testid="battle-panes">
                {seats.map((seat) => {
                    const won = battle.status === "completed" && battle.winner_seat_indices?.includes(seat.seat_index);
                    const myReveal = activeReveal && activeReveal.picks?.find((p) => p.seat_index === seat.seat_index);
                    return (
                        <SeatPane
                            key={seat.seat_index}
                            seat={seat}
                            won={won}
                            battleStatus={battle.status}
                            payoutPerWinner={battle.payout_per_winner_ton}
                            reveals={revealsBySeat[seat.seat_index] || []}
                            activeReveal={myReveal}
                            isYou={seat.user_id === user?.id}
                        />
                    );
                })}
            </div>

            {/* Footer info */}
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs">
                <div className="flex items-center gap-3">
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">{t("battles.pot")}</span>
                    <span className="font-mono text-gold-bright tabular-nums">{formatTON(battle.pot_ton)} TON</span>
                    <span className="text-white/40 uppercase tracking-wider text-[10px]">{t("battles.payout_each")}</span>
                    <span className="font-mono text-emerald-300 tabular-nums">
                        {formatTON(battle.pot_ton * (1 - battle.house_rake_pct / 100) / Math.max(battle.winner_seat_indices?.length || 1, 1))} TON
                    </span>
                </div>
                {canLeave && (
                    <button onClick={leave} data-testid="battle-leave-btn"
                        className="bg-rose-500/20 hover:bg-rose-500/40 border border-rose-500/40 rounded-md px-3 py-1 text-rose-200 text-[11px] font-bold">
                        {t("battles.leave")}
                    </button>
                )}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-white/40 flex-wrap">
                <span>seed_hash</span>
                <code className="font-mono">{battle.server_seed_hash?.slice(0, 14)}…{battle.server_seed_hash?.slice(-6)}</code>
                <span>·</span>
                <span>rake {battle.house_rake_pct}%</span>
            </div>

            {showVerifier && (
                <VerifyModal data={verify} onClose={() => setShowVerifier(false)} />
            )}
        </main>
    );
}


function SeatPane({ seat, won, battleStatus, payoutPerWinner, reveals, activeReveal, isYou }) {
    const { t } = useTranslation();
    return (
        <div
            data-testid={`seat-pane-${seat.seat_index}`}
            className={`rounded-2xl border bg-cyber-surface/70 p-3 space-y-3 ${
                won ? "border-gold-bright/60 shadow-[0_0_30px_rgba(255,215,0,0.45)]"
                    : isYou ? "border-gold-500/45"
                    : "border-white/10"
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center font-mono text-[10px] flex-shrink-0">
                        {seat.seat_index + 1}
                    </div>
                    <div className="min-w-0">
                        <div className="text-xs font-bold truncate">
                            {seat.user_id ? `@${seat.username || `tg${seat.telegram_id}`}` : <span className="text-white/30">empty</span>}
                            {isYou && <span className="ml-1 text-gold-bright text-[10px]">({t("battles.you")})</span>}
                        </div>
                        {won && <div className="text-[10px] text-gold-bright font-bold flex items-center gap-1"><Trophy className="w-3 h-3" />{t("battles.winner")}</div>}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[9px] uppercase tracking-wider text-white/40">{t("battles.total")}</div>
                    <div className={`font-display font-bold text-base tabular-nums ${won ? "text-gold-bright" : "text-gold-200"}`}>
                        {formatTON(seat.total_payout_ton || 0)}
                    </div>
                </div>
            </div>

            {/* Active reveal animation OR placeholder */}
            <div className="aspect-square rounded-lg bg-black/30 border border-white/10 relative overflow-hidden">
                {activeReveal && activeReveal.item ? (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.6 }}
                        className="absolute inset-0"
                    >
                        <img src={resolveImage(`/api/static/${activeReveal.item.image_path}`)}
                             alt={activeReveal.item.name}
                             onError={(e) => { e.target.src = resolveImage("/api/static/cases/crate_common.png"); }}
                             className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-2 pt-6">
                            <div className="text-[11px] font-bold text-white truncate">{activeReveal.item.name}</div>
                            <div className="text-[10px] text-emerald-300 tabular-nums font-bold">+{formatTON(activeReveal.payout_ton)} TON</div>
                        </div>
                    </motion.div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/30">
                        {battleStatus === "open" ? t("battles.waiting") : t("battles.spin_ready")}
                    </div>
                )}
            </div>

            {/* Reveals row — small thumbnails of completed rounds; flush image */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1" data-testid={`seat-${seat.seat_index}-reveals`}>
                {reveals.map((r, idx) => (
                    <div key={idx} className="flex-shrink-0 w-12 h-12 rounded-md bg-white/[0.05] border border-white/10 relative overflow-hidden">
                        {r.item?.image_path ? (
                            <img src={resolveImage(`/api/static/${r.item.image_path}`)}
                                 onError={(e) => { e.target.src = resolveImage("/api/static/cases/crate_common.png"); }}
                                 className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono text-white/40">{r.item_slug?.slice(0, 6)}</span>
                        )}
                        <span className="absolute -bottom-1 right-0 text-[8px] tabular-nums text-emerald-300 font-mono bg-cyber-bg/80 rounded px-0.5">
                            {formatTON(r.payout_ton, 0)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}


function VerifyModal({ data, onClose }) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3 backdrop-blur-sm"
             onClick={onClose} data-testid="battle-verify-modal">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-cyber-surface border border-gold-500/30 rounded-2xl max-w-xl w-full p-5 max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-gold-bright" />
                        <h2 className="font-display font-bold text-lg">{t("battles.verify.title")}</h2>
                    </div>
                    <button onClick={onClose}><X className="w-5 h-5 text-white/50 hover:text-white" /></button>
                </div>
                {!data && <div className="py-10 text-center text-white/40"><Loader2 className="w-5 h-5 animate-spin inline-block" /></div>}
                {data && (
                    <div className="space-y-3 text-xs">
                        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-lg p-3 space-y-1">
                            <div>✓ server_seed_hash {data.server_seed_hash_matches ? "matches" : "MISMATCH"}</div>
                            <div>✓ all picks reproduced: {data.all_picks_match ? "MATCHES" : "MISMATCH"} ({data.rounds.length} picks)</div>
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                            <span className="text-white/40 uppercase text-[10px] tracking-wider">server_seed</span>
                            <code className="text-white/90 font-mono text-[10px] break-all">{data.server_seed}</code>
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                            <span className="text-white/40 uppercase text-[10px] tracking-wider">winners</span>
                            <span className="text-white/90 font-mono">seats {JSON.stringify(data.winner_seat_indices)} · {formatTON(data.payout_per_winner_ton)} TON each</span>
                        </div>
                        <div className="text-white/40 text-[10px] mt-2">{data.derivation_note}</div>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
