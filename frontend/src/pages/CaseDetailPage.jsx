import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    ArrowLeft, Diamond, Loader2, Sparkles, ShieldCheck, ChevronDown, Info,
} from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { fetchCase, openCase, openCaseBatch, sellInventoryItem, fetchFairCurrent, resolveImage } from "@/lib/api";
import { formatTON, rarityRank } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { ItemTile } from "@/components/ItemTile";
import { CaseOpenAnimation } from "@/components/CaseOpenAnimation";
import { BatchOpenAnimation } from "@/components/BatchOpenAnimation";
import { BatchWinSummary } from "@/components/BatchWinSummary";
import { WinModal } from "@/components/WinModal";

export const CaseDetailPage = ({ balance, refreshBalance }) => {
    const { t } = useTranslation();
    const { id } = useParams();
    const nav = useNavigate();
    const [data, setData] = useState(null);
    const [fair, setFair] = useState(null);
    const [sort, setSort] = useState("rarity_desc");
    const [opening, setOpening] = useState(false);
    const [roll, setRoll] = useState(null);
    const [animatingDone, setAnimatingDone] = useState(false);
    const [busy, setBusy] = useState(false);
    const [batchOpening, setBatchOpening] = useState(false);
    const [batch, setBatch] = useState(null);
    const [batchSettled, setBatchSettled] = useState(false);

    const SORT_OPTIONS = [
        { value: "rarity_desc", label: t("case_detail.sort_highest") },
        { value: "rarity_asc", label: t("case_detail.sort_lowest") },
        { value: "prob_desc", label: t("case_detail.sort_most_likely") },
    ];

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [c, f] = await Promise.all([fetchCase(id), fetchFairCurrent()]);
                if (cancelled) return;
                setData(c);
                setFair(f);
            } catch (e) {
                toast.error(t("case_detail.load_failed"), { description: e?.response?.data?.detail || e?.message });
            }
        })();
        return () => { cancelled = true; };
    }, [id, t]);

    const basketSorted = useMemo(() => {
        if (!data) return [];
        const arr = [...data.basket];
        switch (sort) {
            case "rarity_asc":
                arr.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.payout_ton - b.payout_ton);
                break;
            case "prob_desc":
                arr.sort((a, b) => b.probability - a.probability);
                break;
            default:
                arr.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.payout_ton - a.payout_ton);
        }
        return arr;
    }, [data, sort]);

    const handleOpen = async () => {
        if (!data) return;
        if (balance < data.price_ton) {
            toast.error(t("case_detail.not_enough_ton"), {
                description: t("case_detail.need_more", { amount: formatTON(data.price_ton - balance) }),
            });
            return;
        }
        setOpening(true);
        setAnimatingDone(false);
        setRoll(null);
        try {
            const clientSeed = fair?.client_seed_suggestion || `c-${Date.now()}`;
            const res = await openCase(data.id, clientSeed);
            setRoll(res);
            refreshBalance?.();
        } catch (e) {
            toast.error(t("case_detail.open_failed"), { description: e?.response?.data?.detail || e?.message });
            setOpening(false);
        }
    };

    const handleOpenBatch = async () => {
        if (!data || batchOpening) return;
        const totalCost = data.price_ton * 10;
        if (balance < totalCost) {
            toast.error(t("case_detail.not_enough_ton_x10"), {
                description: t("case_detail.need_more_x10", { amount: formatTON(totalCost - balance) }),
            });
            return;
        }
        setBatchOpening(true);
        setBatchSettled(false);
        setBatch(null);
        try {
            const clientSeed = fair?.client_seed_suggestion || `c10-${Date.now()}`;
            const res = await openCaseBatch(data.id, clientSeed, 10);
            setBatch(res);
            refreshBalance?.();
        } catch (e) {
            toast.error(t("case_detail.batch_failed"), { description: e?.response?.data?.detail || e?.message });
            setBatchOpening(false);
        }
    };

    const handleBatchSellAll = async () => {
        if (!batch || busy) return;
        setBusy(true);
        let success = 0;
        let lastBal = null;
        for (const r of batch.rolls) {
            try {
                const resp = await sellInventoryItem(r.inventory_id);
                lastBal = resp.balance_ton;
                success++;
            } catch { /* ignore */ }
        }
        if (lastBal !== null) refreshBalance?.(lastBal);
        toast.success(t("win_modal.sold_count", {
            count: success,
            amount: formatTON(batch.total_won_ton),
        }));
        setBusy(false);
        closeBatchFlow();
    };
    const handleBatchKeepAll = () => {
        toast.success(t("win_modal.kept_all"));
        closeBatchFlow();
    };
    const closeBatchFlow = () => {
        setBatch(null);
        setBatchOpening(false);
        setBatchSettled(false);
        fetchFairCurrent().then(setFair).catch(() => {});
    };

    const handleSell = async (invId) => {
        setBusy(true);
        try {
            const resp = await sellInventoryItem(invId);
            toast.success(t("win_modal.sold_for", { amount: formatTON(roll.payout_ton) }));
            refreshBalance?.(resp.balance_ton);
        } catch (e) {
            toast.error(t("win_modal.sell_failed"), { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
            closeRollFlow();
        }
    };

    const handleKeep = () => {
        toast.success(t("win_modal.kept_one"));
        closeRollFlow();
    };

    const closeRollFlow = () => {
        setRoll(null);
        setOpening(false);
        setAnimatingDone(false);
        fetchFairCurrent().then(setFair).catch(() => {});
    };

    if (!data) {
        return (
            <main className="min-h-[60vh] flex items-center justify-center text-white/50">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t("case_detail.loading")}
            </main>
        );
    }

    return (
        <main data-testid="case-detail-page" className="mx-auto px-4 sm:px-6 pt-3 pb-32 lg:pb-8
        space-y-5 max-w-[430px] sm:max-w-[640px] lg:max-w-[860px]">
            <button
                data-testid="back-to-cases"
                onClick={() => nav(-1)}
                className="inline-flex items-center gap-1 text-white/60 hover:text-cyber-cyan text-sm transition"
            >
                <ArrowLeft className="w-4 h-4" /> {t("case_detail.back")}
            </button>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="relative overflow-hidden rounded-3xl border border-white/10"
            >
                <img
                    src={resolveImage(data.image_url)}
                    alt={data.name}
                    className="w-full h-56 object-cover"
                    draggable={false}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-cyber-bg via-cyber-bg/40 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4">
                    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyber-cyan">
                        {t("case_detail.rtp_badge", { rtp: data.actual_ev_pct.toFixed(0) })}
                    </div>
                    <h1 className="font-display text-3xl font-black tracking-tighter text-white">
                        {data.name}
                    </h1>
                    <div className="inline-flex items-center gap-1.5 bg-cyber-bg/80 backdrop-blur-md border border-cyber-cyan/30 rounded-lg px-3 py-1.5 mt-2">
                        <Diamond className="w-4 h-4 text-cyber-cyan" strokeWidth={2.5} />
                        <span className="font-display font-black text-base tabular-nums">
                            {formatTON(data.price_ton, 0)}
                        </span>
                        <span className="text-[10px] font-bold text-white/60">{t("case_detail.ton_per_open")}</span>
                    </div>
                </div>
            </motion.div>

            {opening && roll && (
                <CaseOpenAnimation
                    basket={data.basket}
                    winner={roll.winning_item}
                    onSettled={() => setAnimatingDone(true)}
                />
            )}

            {batchOpening && batch && (
                <BatchOpenAnimation
                    basket={data.basket}
                    rolls={batch.rolls}
                    onAllSettled={() => {
                        // Phase 6a — fire ONE rarity chime for the highest rarity in the batch
                        // (plus confetti burst if any roll is jackpot, defined as ≥5× the case price).
                        const ranks = batch.rolls.map(r => rarityRank(r.winning_item.rarity));
                        const highestIdx = ranks.indexOf(Math.max(...ranks));
                        const highest = batch.rolls[highestIdx]?.winning_item?.rarity || "common";
                        const hasJackpot = batch.rolls.some(r =>
                            r.payout_ton >= data.price_ton * 5 || r.winning_item.rarity === "jackpot"
                        );
                        sfx.playBatchWin(highest, hasJackpot);
                        setBatchSettled(true);
                    }}
                />
            )}

            {!opening && !batchOpening && (
                <div className="grid grid-cols-3 gap-2">
                    <button
                        data-testid="open-case-btn"
                        onClick={handleOpen}
                        disabled={opening}
                        className="col-span-2 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-display font-black text-base rounded-2xl px-6 py-4 shadow-neon-purple hover:shadow-neon-cyan active:scale-[0.99] transition-all uppercase tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        <Sparkles className="w-5 h-5" />
                        {t("case_detail.open_btn", { price: formatTON(data.price_ton, 0) })}
                    </button>
                    <button
                        data-testid="open-case-batch10-btn"
                        onClick={handleOpenBatch}
                        disabled={batchOpening}
                        className="col-span-1 bg-cyber-surface border-2 border-cyber-cyan/40 hover:border-cyber-cyan transition text-cyber-cyan font-display font-black text-base rounded-2xl px-3 py-4 uppercase tracking-wider inline-flex flex-col items-center justify-center gap-0 disabled:opacity-60"
                    >
                        <span>{t("case_detail.open_x10_total")}</span>
                        <span className="text-[9px] text-white/50 font-bold">
                            {formatTON(data.price_ton * 10, 0)}
                        </span>
                    </button>
                </div>
            )}

            {!opening && fair && (
                <details className="bg-cyber-surface/60 border border-white/10 rounded-xl px-3 py-2">
                    <summary className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60 flex items-center justify-between cursor-pointer">
                        <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-cyber-cyan" /> {t("case_detail.fair_title")}
                        </span>
                        <ChevronDown className="w-3 h-3 text-white/40" />
                    </summary>
                    <div className="mt-2 space-y-1 text-[10px] font-mono text-white/60 break-all">
                        <div><span className="text-white/40">{t("case_detail.fair_server_seed")}</span> {fair.server_seed_hash}</div>
                        <div><span className="text-white/40">{t("case_detail.fair_nonce", { nonce: fair.nonce, until: fair.rolls_until_rotation })}</span></div>
                        <div><span className="text-white/40">{t("case_detail.fair_client_seed")}</span> {fair.client_seed_suggestion}</div>
                    </div>
                </details>
            )}

            <section data-testid="case-items-grid">
                <div className="flex items-baseline justify-between mb-3">
                    <h2 className="font-display text-lg font-bold tracking-tight">
                        {t("case_detail.whats_inside")}
                    </h2>
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        className="bg-cyber-surface border border-white/10 rounded-md text-xs px-2 py-1 text-white/80 focus:border-cyber-cyan outline-none"
                    >
                        {SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {basketSorted.map((entry) => (
                        <ItemTile key={entry.slug} item={entry} size="md" />
                    ))}
                </div>

                <details data-testid="floor-disclaimer" className="mt-4 rounded-xl bg-cyber-surface/50 border border-cyber-cyan/15 px-3 py-2.5">
                    <summary className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyber-cyan/85 inline-flex items-center gap-1.5 cursor-pointer list-none">
                        <Info className="w-3 h-3" />
                        {t("case_detail.withdrawals_title")}
                    </summary>
                    <div className="mt-2 text-[11px] text-white/65 leading-snug">
                        <Trans
                            i18nKey="case_detail.withdrawals_body"
                            components={{
                                strong: <b className="text-white" />,
                                span: <span className="text-white/85" />,
                            }}
                        />
                    </div>
                </details>
            </section>

            <WinModal
                open={Boolean(roll && animatingDone)}
                roll={roll}
                casePrice={data.price_ton}
                onSell={handleSell}
                onKeep={handleKeep}
                onClose={() => {}}
                busy={busy}
            />
            <BatchWinSummary
                open={Boolean(batch && batchSettled)}
                batch={batch}
                casePrice={data.price_ton}
                onSellAll={handleBatchSellAll}
                onKeepAll={handleBatchKeepAll}
                onClose={closeBatchFlow}
                busy={busy}
            />
        </main>
    );
};
