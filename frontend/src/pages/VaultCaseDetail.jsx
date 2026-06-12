import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
    fetchCase, openCase, openCaseBatch, fetchFairCurrent,
    sellInventoryItem, resolveImage,
} from "@/lib/api";
import { openDeposit } from "@/lib/deposit";
import { formatTON, rarityRank } from "@/lib/rarity";
import { VaultReel } from "@/components/VaultReel";

const SORTS = [
    { v: "rarity_desc", l: "Best first" },
    { v: "rarity_asc", l: "Worst first" },
    { v: "prob_desc", l: "Most likely" },
];

function Coin() { return <span className="coin" />; }

// ── Single-win reveal ────────────────────────────────────────────
function WinReveal({ roll, casePrice, busy, onSell, onKeep }) {
    const item = roll.winning_item;
    const img = resolveImage(item.image_url);
    const mult = casePrice ? roll.payout_ton / casePrice : 0;
    return (
        <div className="v-reveal" role="dialog" aria-label="You won">
            <div className="v-revealcard" data-rarity={item.rarity}>
                <div className="won">You won · {mult.toFixed(2)}×</div>
                {img ? <img className="art" src={img} alt={item.name} />
                    : <div className="art emoji">🎁</div>}
                <h2 className="v-disp">{item.name}</h2>
                <div className="pay v-mono"><Coin />{formatTON(roll.payout_ton)}</div>
                <div className="v-revealacts">
                    <button className="v-cta v-cta--emerald" disabled={busy} onClick={() => onSell(roll.inventory_id)}>
                        Sell · {formatTON(roll.payout_ton, 0)}
                    </button>
                    <button className="v-ghost" disabled={busy} onClick={onKeep}>Keep</button>
                </div>
            </div>
        </div>
    );
}

// ── Batch (x10) summary ──────────────────────────────────────────
function BatchReveal({ batch, busy, onSellAll, onKeepAll }) {
    const rolls = [...batch.rolls].sort((a, b) => rarityRank(b.winning_item.rarity) - rarityRank(a.winning_item.rarity));
    const top = rolls[0]?.winning_item?.rarity || "common";
    return (
        <div className="v-reveal" role="dialog" aria-label="Batch result">
            <div className="v-revealcard wide" data-rarity={top}>
                <div className="won">10× opened</div>
                <div className="v-batchgrid">
                    {rolls.map((r, i) => {
                        const img = resolveImage(r.winning_item.image_url);
                        return (
                            <div key={i} className="v-batchcell" data-rarity={r.winning_item.rarity}>
                                {img ? <img src={img} alt="" /> : <span className="emoji">🎁</span>}
                            </div>
                        );
                    })}
                </div>
                <div className="v-batchtotal v-mono"><Coin />{formatTON(batch.total_won_ton)}</div>
                <div className="v-revealacts">
                    <button className="v-cta v-cta--emerald" disabled={busy} onClick={onSellAll}>Sell all</button>
                    <button className="v-ghost" disabled={busy} onClick={onKeepAll}>Keep all</button>
                </div>
            </div>
        </div>
    );
}

function BasketTile({ e }) {
    const img = resolveImage(e.image_url);
    return (
        <div className="v-bitem" data-rarity={e.rarity}>
            {img ? <img src={img} alt={e.name} /> : <span className="emoji">🎁</span>}
            <span className="nm" title={e.name}>{e.name}</span>
            <span className="pz v-mono">{formatTON(e.payout_ton, 0)}</span>
            <span className="pct v-mono">{(e.probability * 100).toFixed(e.probability < 0.01 ? 2 : 1)}%</span>
        </div>
    );
}

export const VaultCaseDetail = ({ balance = 0, refreshBalance }) => {
    const { id } = useParams();
    const nav = useNavigate();
    const [data, setData] = useState(null);
    const [fair, setFair] = useState(null);
    const [sort, setSort] = useState("rarity_desc");

    const [reel, setReel] = useState(null);      // active single-open roll (reel running)
    const [roll, setRoll] = useState(null);      // settled single-open roll (reveal)
    const [batch, setBatch] = useState(null);    // settled batch
    const [busy, setBusy] = useState(false);     // sell in flight

    useEffect(() => {
        let off = false;
        (async () => {
            try {
                const [c, f] = await Promise.all([fetchCase(id), fetchFairCurrent()]);
                if (off) return;
                setData(c); setFair(f);
            } catch (e) {
                toast.error("Could not load case", { description: e?.response?.data?.detail || e?.message });
            }
        })();
        return () => { off = true; };
    }, [id]);

    const basket = useMemo(() => {
        if (!data) return [];
        const a = [...data.basket];
        if (sort === "rarity_asc") a.sort((x, y) => rarityRank(x.rarity) - rarityRank(y.rarity) || x.payout_ton - y.payout_ton);
        else if (sort === "prob_desc") a.sort((x, y) => y.probability - x.probability);
        else a.sort((x, y) => rarityRank(y.rarity) - rarityRank(x.rarity) || y.payout_ton - x.payout_ton);
        return a;
    }, [data, sort]);

    const refreshFair = () => fetchFairCurrent().then(setFair).catch(() => {});

    const open1 = async () => {
        if (!data || reel || roll) return;
        if (balance < data.price_ton) {
            toast.error("Not enough TON", {
                description: `Need ${formatTON(data.price_ton - balance)} more`,
                action: { label: "Deposit", onClick: openDeposit },
            });
            return;
        }
        try {
            const seed = fair?.client_seed_suggestion || `c-${id}`;
            const res = await openCase(data.id, seed);
            setReel(res);
            refreshBalance?.();
        } catch (e) {
            toast.error("Open failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    const open10 = async () => {
        if (!data || reel || batch) return;
        const cost = data.price_ton * 10;
        if (balance < cost) {
            toast.error("Not enough TON for 10×", {
                description: `Need ${formatTON(cost - balance)} more`,
                action: { label: "Deposit", onClick: openDeposit },
            });
            return;
        }
        try {
            const seed = fair?.client_seed_suggestion || `c10-${id}`;
            const res = await openCaseBatch(data.id, seed, 10);
            setBatch(res);
            refreshBalance?.();
        } catch (e) {
            toast.error("10× open failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    const onReelSettled = () => { setRoll(reel); setReel(null); };

    const sellOne = async (invId) => {
        setBusy(true);
        try {
            const r = await sellInventoryItem(invId);
            refreshBalance?.(r.balance_ton);
            toast.success(`Sold for ${formatTON(roll.payout_ton)} TON`);
        } catch (e) {
            toast.error("Sell failed", { description: e?.response?.data?.detail || e?.message });
        } finally { setBusy(false); setRoll(null); refreshFair(); }
    };
    const keepOne = () => { setRoll(null); refreshFair(); toast.success("Kept in your gifts"); };

    const sellAll = async () => {
        if (!batch) return;
        setBusy(true);
        let last = null;
        for (const r of batch.rolls) {
            try { last = (await sellInventoryItem(r.inventory_id)).balance_ton; } catch { /* skip */ }
        }
        if (last != null) refreshBalance?.(last);
        toast.success(`Sold 10 for ${formatTON(batch.total_won_ton)} TON`);
        setBusy(false); setBatch(null); refreshFair();
    };
    const keepAll = () => { setBatch(null); refreshFair(); toast.success("Kept all in your gifts"); };

    if (!data) {
        return <main className="v-wrap"><div className="v-empty" style={{ paddingTop: 80 }}>Loading case…</div></main>;
    }

    const heroImg = resolveImage(data.image_url);
    const rtp = typeof data.actual_ev_pct === "number" ? data.actual_ev_pct.toFixed(0) : null;

    return (
        <main className="v-wrap">
            <button className="v-back" onClick={() => nav(-1)}><span className="a">←</span> Back</button>

            <section className="v-cdhero" data-rarity={data.basket?.length ? data.basket[0].rarity : "legendary"} style={{ marginTop: 10 }}>
                {rtp && <div className="rtp">Returns ~{rtp}%</div>}
                {heroImg ? <img className="art" src={heroImg} alt={data.name} /> : <div className="art emoji">🎁</div>}
                <h1 className="v-disp">{data.name}</h1>
                <div className="v-mono" style={{ font: "600 16px 'JetBrains Mono'", color: "var(--v-gold-hi)", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Coin />{formatTON(data.price_ton)} <span style={{ font: "600 10px 'Inter'", color: "var(--v-muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>per open</span>
                </div>
            </section>

            {reel && <VaultReel basket={data.basket} winner={reel.winning_item} onSettled={onReelSettled} />}

            {!reel && (
                <div className="v-openbar">
                    <button className="v-cta" onClick={open1}>Open · {formatTON(data.price_ton, 0)} TON</button>
                    <button className="v-x10" onClick={open10}>10×<small>{formatTON(data.price_ton * 10, 0)} TON</small></button>
                </div>
            )}

            <div className="v-sechead" style={{ marginTop: 26 }}>
                <h2 className="v-disp">What's inside</h2>
                <select className="v-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
            </div>
            <div className="v-basket">
                {basket.map((e) => <BasketTile key={e.slug} e={e} />)}
            </div>

            {fair && (
                <details className="v-fair">
                    <summary>◆ Provably fair</summary>
                    <div className="body">
                        <div><span className="k">server seed hash</span><br />{fair.server_seed_hash}</div>
                        <div><span className="k">nonce</span> {fair.nonce} · <span className="k">rotates in</span> {fair.rolls_until_rotation}</div>
                        <div><span className="k">client seed</span><br />{fair.client_seed_suggestion}</div>
                    </div>
                </details>
            )}

            {roll && <WinReveal roll={roll} casePrice={data.price_ton} busy={busy} onSell={sellOne} onKeep={keepOne} />}
            {batch && <BatchReveal batch={batch} busy={busy} onSellAll={sellAll} onKeepAll={keepAll} />}
        </main>
    );
};

export default VaultCaseDetail;
