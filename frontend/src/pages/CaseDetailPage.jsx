import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    ArrowLeft, Diamond, Loader2, Sparkles, ShieldCheck, ChevronDown, Info,
} from "lucide-react";
import { fetchCase, openCase, openCaseBatch, sellInventoryItem, fetchFairCurrent, resolveImage } from "@/lib/api";
import { formatTON, rarityRank } from "@/lib/rarity";
import { ItemTile } from "@/components/ItemTile";
import { CaseOpenAnimation } from "@/components/CaseOpenAnimation";
import { BatchOpenAnimation } from "@/components/BatchOpenAnimation";
import { BatchWinSummary } from "@/components/BatchWinSummary";
import { WinModal } from "@/components/WinModal";

const SORT_OPTIONS = [
    { value: "rarity_desc", label: "Highest first" },
    { value: "rarity_asc", label: "Lowest first" },
    { value: "prob_desc", label: "Most likely" },
];

export const CaseDetailPage = ({ balance, refreshBalance }) => {
    const { id } = useParams();
    const nav = useNavigate();
    const [data, setData] = useState(null);
    const [fair, setFair] = useState(null);
    const [sort, setSort] = useState("rarity_desc");
    const [opening, setOpening] = useState(false);
    const [roll, setRoll] = useState(null);    // case open response
    const [animatingDone, setAnimatingDone] = useState(false);
    const [busy, setBusy] = useState(false);
    // batch state
    const [batchOpening, setBatchOpening] = useState(false);
    const [batch, setBatch] = useState(null);  // batch response
    const [batchSettled, setBatchSettled] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [c, f] = await Promise.all([fetchCase(id), fetchFairCurrent()]);
                if (cancelled) return;
                setData(c);
                setFair(f);
            } catch (e) {
                toast.error("Failed to load case", { description: e?.response?.data?.detail || e?.message });
            }
        })();
        return () => { cancelled = true; };
    }, [id]);

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
            toast.error("Not enough TON", {
                description: `Need ${formatTON(data.price_ton - balance)} more — top up first.`,
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
            toast.error("Open failed", { description: e?.response?.data?.detail || e?.message });
            setOpening(false);
        }
    };

    const handleOpenBatch = async () => {
        if (!data || batchOpening) return;
        const totalCost = data.price_ton * 10;
        if (balance < totalCost) {
            toast.error("Not enough TON for ×10", {
                description: `Need ${formatTON(totalCost - balance)} more.`,
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
            toast.error("Batch open failed", { description: e?.response?.data?.detail || e?.message });
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
                lastBal = await sellInventoryItem(r.inventory_id);
                success++;
            } catch { /* ignore */ }
        }
        if (lastBal !== null) refreshBalance?.(lastBal);
        toast.success(`Sold all ${success} · +${formatTON(batch.total_won_ton)} TON`);
        setBusy(false);
        closeBatchFlow();
    };
    const handleBatchKeepAll = () => {
        toast.success("Items saved to inventory");
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
            const newBal = await sellInventoryItem(invId);
            toast.success(`Sold for ${formatTON(roll.payout_ton)} TON`);
            refreshBalance?.(newBal);
        } catch (e) {
            toast.error("Sell failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
            closeRollFlow();
        }
    };

    const handleKeep = () => {
        toast.success("Item saved to inventory");
        closeRollFlow();
    };

    const closeRollFlow = () => {
        setRoll(null);
        setOpening(false);
        setAnimatingDone(false);
        // refresh fair so we get next nonce
        fetchFairCurrent().then(setFair).catch(() => {});
    };

    if (!data) {
        return (
            <main className="min-h-[60vh] flex items-center justify-center text-white/50">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading case…
            </main>
        );
    }

    return (
        <main data-testid="case-detail-page" className="max-w-[430px] mx-auto px-4 pt-3 pb-32 space-y-5">
            {/* Back */}
            <button
                data-testid="back-to-cases"
                onClick={() => nav(-1)}
                className="inline-flex items-center gap-1 text-white/60 hover:text-cyber-cyan text-sm transition"
            >
                <ArrowLeft className="w-4 h-4" /> Cases
            </button>

            {/* Hero cover */}
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
                        Lydomania · {data.actual_ev_pct.toFixed(0)}% RTP
                    </div>
                    <h1 className="font-display text-3xl font-black tracking-tighter text-white">
                        {data.name}
                    </h1>
                    <div className="inline-flex items-center gap-1.5 bg-cyber-bg/80 backdrop-blur-md border border-cyber-cyan/30 rounded-lg px-3 py-1.5 mt-2">
                        <Diamond className="w-4 h-4 text-cyber-cyan" strokeWidth={2.5} />
                        <span className="font-display font-black text-base tabular-nums">
                            {formatTON(data.price_ton, 0)}
                        </span>
                        <span className="text-[10px] font-bold text-white/60">TON / open</span>
                    </div>
                </div>
            </motion.div>

            {/* Roll strip while opening */}
            {opening && roll && (
                <CaseOpenAnimation
                    basket={data.basket}
                    winner={roll.winning_item}
                    onSettled={() => setAnimatingDone(true)}
                />
            )}

            {/* Batch ×10 strips */}
            {batchOpening && batch && (
                <BatchOpenAnimation
                    basket={data.basket}
                    rolls={batch.rolls}
                    onAllSettled={() => setBatchSettled(true)}
                />
            )}

            {/* Open buttons */}
            {!opening && !batchOpening && (
                <div className="grid grid-cols-3 gap-2">
                    <button
                        data-testid="open-case-btn"
                        onClick={handleOpen}
                        disabled={opening}
                        className="col-span-2 bg-gradient-to-r from-cyber-purple to-cyber-cyan text-white font-display font-black text-base rounded-2xl px-6 py-4 shadow-neon-purple hover:shadow-neon-cyan active:scale-[0.99] transition-all uppercase tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        <Sparkles className="w-5 h-5" />
                        Open · {formatTON(data.price_ton, 0)}
                    </button>
                    <button
                        data-testid="open-case-batch10-btn"
                        onClick={handleOpenBatch}
                        disabled={batchOpening}
                        className="col-span-1 bg-cyber-surface border-2 border-cyber-cyan/40 hover:border-cyber-cyan transition text-cyber-cyan font-display font-black text-base rounded-2xl px-3 py-4 uppercase tracking-wider inline-flex flex-col items-center justify-center gap-0 disabled:opacity-60"
                    >
                        <span>×10</span>
                        <span className="text-[9px] text-white/50 font-bold">
                            {formatTON(data.price_ton * 10, 0)}
                        </span>
                    </button>
                </div>
            )}

            {/* Provably-fair preview */}
            {!opening && fair && (
                <details className="bg-cyber-surface/60 border border-white/10 rounded-xl px-3 py-2">
                    <summary className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60 flex items-center justify-between cursor-pointer">
                        <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-cyber-cyan" /> Provably fair
                        </span>
                        <ChevronDown className="w-3 h-3 text-white/40" />
                    </summary>
                    <div className="mt-2 space-y-1 text-[10px] font-mono text-white/60 break-all">
                        <div><span className="text-white/40">server_seed_hash:</span> {fair.server_seed_hash}</div>
                        <div><span className="text-white/40">nonce:</span> {fair.nonce} · rolls until rotation: {fair.rolls_until_rotation}</div>
                        <div><span className="text-white/40">client seed (sent on open):</span> {fair.client_seed_suggestion}</div>
                    </div>
                </details>
            )}

            {/* What's inside */}
            <section data-testid="case-items-grid">
                <div className="flex items-baseline justify-between mb-3">
                    <h2 className="font-display text-lg font-bold tracking-tight">
                        What's inside
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

                {/* Floor-purchase disclaimer */}
                <details data-testid="floor-disclaimer" className="mt-4 rounded-xl bg-cyber-surface/50 border border-cyber-cyan/15 px-3 py-2.5">
                    <summary className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyber-cyan/85 inline-flex items-center gap-1.5 cursor-pointer list-none">
                        <Info className="w-3 h-3" />
                        How withdrawals work
                    </summary>
                    <div className="mt-2 text-[11px] text-white/65 leading-snug">
                        When you withdraw a won gift, our team purchases the <b className="text-white">cheapest available variant</b> from the Telegram gift market (Portals/MRKT/Fragment) and sends it directly to your TON wallet. You'll receive a real Telegram gift NFT — <span className="text-white/85">backdrop and model may vary</span>, since we always buy floor. Typical delivery time: <b className="text-white">under 24 hours</b>.
                    </div>
                </details>
            </section>

            {/* Win modal */}
            <WinModal
                open={Boolean(roll && animatingDone)}
                roll={roll}
                casePrice={data.price_ton}
                onSell={handleSell}
                onKeep={handleKeep}
                onClose={() => {}}
                busy={busy}
            />
            {/* Batch summary */}
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
