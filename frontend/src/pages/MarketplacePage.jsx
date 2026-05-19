/**
 * Phase 9 — P2P Marketplace page.
 *
 * Browse listings, filter, buy, manage own listings.
 * Listing creation from inventory: handled in InventoryPage (next iteration);
 * we expose the API here for the MVP and accept that the "List from Inventory"
 * CTA stub is on the inventory page (defer).
 */
import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShoppingBag, Coins, Loader2, Tag, X } from "lucide-react";
import { toast } from "sonner";

import { http, resolveImage } from "@/lib/api";
import { formatTON, RARITY_HEX } from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifyError, notifySuccess } from "@/lib/haptics";
import { GiftCard } from "@/components/common/GiftCard";

const PRM = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


function ListingCard({ listing, onBuy, busy, isMine }) {
    const itemForCard = {
        id: listing.listing_id,
        item_name: listing.item_name || listing.item_template_slug,
        item_slug: listing.item_template_slug,
        image_url: listing.image_path,
        rarity: listing.rarity,
        payout_ton: listing.price_ton,
    };
    const actionSlot = isMine ? (
        <span data-testid={`market-listing-${listing.listing_id}-mine`}
              className="block text-center text-[9px] uppercase tracking-wider font-bold text-gold-300/85 px-1.5 py-1 rounded bg-gold-500/10 border border-gold-500/30">
            YOURS
        </span>
    ) : (
        <button
            type="button" onClick={() => onBuy(listing)} disabled={busy}
            data-testid={`market-listing-${listing.listing_id}-buy-btn`}
            className="w-full px-2 py-1.5 rounded bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 text-[10px] font-black uppercase tracking-wider hover:brightness-105 disabled:opacity-40"
        >
            Buy
        </button>
    );
    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="min-w-0"
                    data-testid={`market-listing-${listing.listing_id}`}>
            <GiftCard
                item={itemForCard}
                size="md"
                priceChip={
                    <span data-testid={`market-listing-${listing.listing_id}-price`}>
                        {formatTON(listing.price_ton)} TON
                    </span>
                }
                actionSlot={actionSlot}
                className="!w-full"
                testid={`market-listing-${listing.listing_id}-card`}
            />
        </motion.div>
    );
}


export default function MarketplacePage({ user, balance, refreshBalance }) {
    const [rows, setRows] = useState(null);
    const [mine, setMine] = useState({ active: [], history: [] });
    const [tab, setTab] = useState("browse");
    const [sort, setSort] = useState("recent");
    const [busy, setBusy] = useState(false);
    const [confirmBuy, setConfirmBuy] = useState(null);   // listing being confirmed

    const fetchBrowse = useCallback(async () => {
        try {
            const { data } = await http.get("/marketplace", { params: { sort, page_size: 30 } });
            setRows(data.rows || []);
        } catch (_) { toast.error("Couldn't load listings."); }
    }, [sort]);

    const fetchMine = useCallback(async () => {
        try {
            const { data } = await http.get("/marketplace/my");
            setMine({ active: data.active || [], history: data.history || [] });
        } catch (_) {}
    }, []);

    useEffect(() => { if (user) { fetchBrowse(); fetchMine(); } }, [user, fetchBrowse, fetchMine]);

    const doBuy = useCallback(async (listing) => {
        setBusy(true); tapHeavy();
        try {
            const { data } = await http.post("/marketplace/buy", { listing_id: listing.listing_id });
            sfx.play("confetti_burst", { volume: 0.5 });
            sfx.play("success_bell", { volume: 0.5 });
            notifySuccess();
            toast.success(`Bought ${listing.item_name} for ${formatTON(data.price_ton)} TON`);
            refreshBalance?.();
            await fetchBrowse(); await fetchMine();
            setConfirmBuy(null);
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Purchase failed");
        } finally { setBusy(false); }
    }, [refreshBalance, fetchBrowse, fetchMine]);

    const doCancel = useCallback(async (listingId) => {
        setBusy(true); tapMedium();
        try {
            await http.post("/marketplace/cancel", { listing_id: listingId });
            toast.success("Listing cancelled.");
            await fetchMine(); await fetchBrowse();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Cancel failed");
        } finally { setBusy(false); }
    }, [fetchMine, fetchBrowse]);

    if (!user) return <main className="p-6 text-center text-white/60" data-testid="market-page">Sign in to view the marketplace.</main>;

    return (
        <main
            className="px-3 sm:px-5 pt-3 pb-24 max-w-5xl mx-auto w-full overflow-x-hidden space-y-4"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
            data-testid="market-page"
        >
            <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="relative rounded-2xl border border-amber-300/30 overflow-hidden p-4"
                style={{ minHeight: 120, background: "linear-gradient(120deg, rgba(25,18,5,0.95), rgba(25,18,5,0.55) 60%, transparent), radial-gradient(circle at 90% 50%, rgba(251,191,36,0.25), transparent 60%), #1a1206" }}
                data-testid="market-hero"
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <ShoppingBag className="w-4 h-4 text-amber-300" />
                    <span className="text-[10px] uppercase tracking-[0.32em] font-mono text-amber-300/90">P2P</span>
                </div>
                <h1 className="text-2xl font-bold text-white">Gift Marketplace</h1>
                <p className="text-sm text-white/70 mt-1">Buy & sell gifts player-to-player. 5% fee · 7-day listings.</p>
            </motion.div>

            {/* Tabs */}
            <div className="flex gap-2" data-testid="market-tabs">
                {["browse", "mine"].map((t) => (
                    <button key={t} type="button"
                        onClick={() => { setTab(t); tapMedium(); }}
                        className={`flex-1 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
                            tab === t ? "bg-amber-400/20 border border-amber-300/50 text-amber-100"
                                      : "bg-white/5 border border-white/10 text-white/60"
                        }`}
                        data-testid={`market-tab-${t}`}>
                        {t === "browse" ? "Browse" : "My listings"}
                    </button>
                ))}
            </div>

            {tab === "browse" && (
                <>
                    <div className="flex gap-2 overflow-x-auto" data-testid="market-sort">
                        {[
                            ["recent", "Recent"], ["price_asc", "Price ↑"], ["price_desc", "Price ↓"],
                        ].map(([k, l]) => (
                            <button key={k} type="button" onClick={() => { setSort(k); tapMedium(); }}
                                className={`shrink-0 px-2.5 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors ${
                                    sort === k ? "bg-cyan-400/20 border border-cyan-300/50 text-cyan-100"
                                               : "bg-white/5 border border-white/10 text-white/60"
                                }`}
                                data-testid={`market-sort-${k}`}>{l}</button>
                        ))}
                    </div>
                    {rows === null && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {[0,1,2,3].map((i) => (
                                <div key={i} className="h-44 rounded-xl bg-zinc-900/60 animate-pulse" />
                            ))}
                        </div>
                    )}
                    {rows !== null && rows.length === 0 && (
                        <div className="rounded-xl bg-zinc-900/60 border border-white/10 p-8 text-center" data-testid="market-empty">
                            <ShoppingBag className="w-8 h-8 mx-auto text-white/30 mb-2" />
                            <p className="text-sm text-white/55">No listings yet. Be the first to sell a gift.</p>
                        </div>
                    )}
                    {rows !== null && rows.length > 0 && (
                        <section className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="market-grid">
                            {rows.map((l) => (
                                <ListingCard key={l.listing_id} listing={l}
                                    onBuy={(lst) => setConfirmBuy(lst)}
                                    busy={busy} isMine={l.seller_user_id === user.id}/>
                            ))}
                        </section>
                    )}
                </>
            )}

            {tab === "mine" && (
                <section className="space-y-3" data-testid="market-mine">
                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-2">Active</div>
                        {mine.active.length === 0 && <p className="text-sm text-white/55 px-3 py-4 text-center" data-testid="market-mine-active-empty">No active listings.</p>}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {mine.active.map((l) => (
                                <div key={l.listing_id} className="relative">
                                    <ListingCard listing={l} onBuy={() => {}} busy={false} isMine />
                                    <button type="button" onClick={() => doCancel(l.listing_id)} disabled={busy}
                                        className="absolute top-1 right-1 p-1 rounded-full bg-rose-500/20 border border-rose-400/40 hover:bg-rose-500/30 text-rose-200"
                                        aria-label="Cancel listing"
                                        data-testid={`market-cancel-${l.listing_id}`}>
                                        <X className="w-3 h-3"/>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold mb-2">History</div>
                        {mine.history.length === 0 && <p className="text-sm text-white/55 px-3 py-4 text-center" data-testid="market-mine-history-empty">No completed listings.</p>}
                        {mine.history.map((l) => (
                            <div key={l.listing_id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/8 mb-1">
                                <span className={`text-[10px] font-bold uppercase ${
                                    l.status === "sold" ? "text-emerald-300" :
                                    l.status === "cancelled" ? "text-zinc-400" : "text-rose-300"
                                }`}>{l.status}</span>
                                <span className="text-white/80 truncate flex-1">{l.item_name}</span>
                                <span className="font-mono text-amber-300">{formatTON(l.price_ton)} TON</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Buy confirmation modal */}
            {confirmBuy && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    onClick={() => setConfirmBuy(null)}
                    className="fixed inset-0 z-[60] bg-zinc-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                    data-testid="market-buy-modal"
                >
                    <motion.div onClick={(e) => e.stopPropagation()}
                        initial={PRM() ? false : { y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                        className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-white/12 p-5">
                        <h2 className="text-lg font-bold text-white mb-1">Confirm purchase</h2>
                        <p className="text-sm text-white/70 mb-3">{confirmBuy.item_name}</p>
                        <div className="rounded-lg bg-black/40 border border-white/10 p-3 mb-3 text-sm space-y-1.5">
                            <div className="flex justify-between"><span className="text-white/55">Price</span><span className="font-mono text-amber-300">{formatTON(confirmBuy.price_ton)} TON</span></div>
                            <div className="flex justify-between"><span className="text-white/55">Your balance</span><span className="font-mono text-white/85">{formatTON(balance || 0)} TON</span></div>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setConfirmBuy(null)}
                                className="flex-1 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm font-bold hover:text-white"
                                data-testid="market-buy-cancel">Cancel</button>
                            <button type="button" onClick={() => doBuy(confirmBuy)} disabled={busy}
                                className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 text-zinc-950 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-1.5"
                                data-testid="market-buy-confirm">
                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Tag className="w-3.5 h-3.5"/>}
                                Confirm
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </main>
    );
}
