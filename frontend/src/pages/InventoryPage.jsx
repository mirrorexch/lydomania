import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
    Diamond, Loader2, Wallet, RefreshCcw, Trophy, History, ChevronRight, Gift, ArrowUpRight,
    Tag, X, Check, ShoppingBag,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    fetchInventory, fetchCases,
    sellInventoryItem, resolveImage, http,
} from "@/lib/api";
import {
    RARITY_HEX, RARITY_ORDER, formatTON,
} from "@/lib/rarity";
import { sfx } from "@/lib/sound";
import { tapMedium, tapHeavy, notifySuccess, notifyError } from "@/lib/haptics";
import { WithdrawModal } from "@/components/WithdrawModal";
import { GiftDepositModal } from "@/components/GiftDepositModal";
import { confirmAsync } from "@/components/common/confirmDialog";
import { GiftCard } from "@/components/common/GiftCard";

const PRM = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const InventoryPage = ({ refreshBalance }) => {
    const { t } = useTranslation();

    const STATUS_TABS = [
        { value: "all", label: t("collection.all") },
        { value: "in_inventory", label: t("collection.owned") },
        { value: "sold", label: t("collection.sold") },
        { value: "withdraw_pending", label: t("collection.pending") },
        { value: "withdrawn", label: t("collection.delivered") },
    ];
    const SORT_OPTIONS = [
        { value: "date_desc", label: t("collection.sort_newest") },
        { value: "date_asc", label: t("collection.sort_oldest") },
        { value: "value_desc", label: t("collection.sort_value_desc") },
        { value: "value_asc", label: t("collection.sort_value_asc") },
    ];

    const [status, setStatus] = useState("in_inventory");
    const [rarity, setRarity] = useState("all");
    const [caseId, setCaseId] = useState("all");
    const [sort, setSort] = useState("date_desc");
    const [items, setItems] = useState([]);
    const [totals, setTotals] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(null);
    const [cases, setCases] = useState([]);
    const [withdrawTarget, setWithdrawTarget] = useState(null);
    const [giftDepositOpen, setGiftDepositOpen] = useState(false);
    // Fix-F: marketplace listing state
    const [listTarget, setListTarget] = useState(null);
    const [listPrice, setListPrice] = useState("");
    const [listingBusy, setListingBusy] = useState(false);
    const [vipDiscountBps, setVipDiscountBps] = useState(0);
    const [marketConfig, setMarketConfig] = useState({
        min_price_ton: 0.1, max_price_ton: 10000, fee_bps_default: 500,
    });

    useEffect(() => {
        // Fetch VIP discount once for fee preview math + marketplace bounds
        (async () => {
            try {
                const { data } = await http.get("/vip/me");
                setVipDiscountBps(int_or_0(data?.tier?.marketplace_fee_discount_bps));
            } catch (_) {}
            try {
                const { data } = await http.get("/marketplace/config");
                if (data) setMarketConfig(data);
            } catch (_) {}
        })();
        function int_or_0(v) { const n = parseInt(v); return Number.isFinite(n) ? n : 0; }
    }, []);

    const openListModal = useCallback((item) => {
        setListTarget(item);
        setListPrice(String(Math.max(0.1, item.payout_ton * 1.5).toFixed(2)));
        tapMedium();
    }, []);
    const closeListModal = useCallback(() => {
        setListTarget(null);
        setListPrice("");
    }, []);

    const submitListing = useCallback(async () => {
        if (!listTarget) return;
        const price = parseFloat(listPrice);
        if (!Number.isFinite(price) || price <= 0) {
            notifyError();
            toast.error(t("inventory.list.invalid_price"));
            return;
        }
        // Fix-F: client-side bounds check sourced from /marketplace/config
        if (price < marketConfig.min_price_ton || price > marketConfig.max_price_ton) {
            notifyError();
            toast.error(t("inventory.list.price_out_of_range", {
                min: marketConfig.min_price_ton, max: marketConfig.max_price_ton,
            }));
            return;
        }
        setListingBusy(true);
        tapHeavy();
        try {
            await http.post("/marketplace/list", {
                inventory_item_id: listTarget.id, price_ton: price,
            });
            sfx.play("success_bell", { volume: 0.45 });
            notifySuccess();
            toast.success(t("inventory.list.listed_toast", { price: price.toFixed(2) }));
            closeListModal();
            await reload();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || t("inventory.list.list_failed"));
        } finally {
            setListingBusy(false);
        }
    }, [listTarget, listPrice, marketConfig, closeListModal, t]);

    const cancelListing = useCallback(async (item) => {
        if (!item.marketplace_listing_id) {
            // Need to find the listing — call /marketplace/my and match by inventory_item_id
            try {
                const { data } = await http.get("/marketplace/my");
                const found = (data.active || []).find((l) => l.inventory_item_id === item.id);
                if (!found) {
                    toast.error(t("inventory.list.listing_not_found"));
                    return;
                }
                item.marketplace_listing_id = found.listing_id;
            } catch (_) {
                toast.error(t("inventory.list.listing_not_found"));
                return;
            }
        }
        setBusy(item.id);
        tapMedium();
        try {
            await http.post("/marketplace/cancel", { listing_id: item.marketplace_listing_id });
            sfx.play("scroll_tick", { volume: 0.35 });
            toast.success(t("inventory.list.cancel_toast"));
            await reload();
        } catch (e) {
            notifyError();
            toast.error(e?.response?.data?.detail || "Cancel failed");
        } finally {
            setBusy(null);
        }
    }, [t]);

    useEffect(() => {
        fetchCases().then(setCases).catch(() => {});
    }, []);

    const reload = async () => {
        setLoading(true);
        try {
            const r = await fetchInventory({ status, rarity, case_id: caseId, sort });
            setItems(r.items);
            setTotals(r.totals);
        } catch (e) {
            toast.error(t("collection.load_failed"), { description: e?.message });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, rarity, caseId, sort]);

    const handleSell = async (item) => {
        if (busy) return;
        setBusy(item.id);
        tapMedium();
        try {
            const r = await sellInventoryItem(item.id);
            sfx.play("coin_drop", { volume: 0.65 });
            notifySuccess();
            if (r.instant_credit) {
                toast.success(t("win_modal.sold_one", { name: item.item_name, amount: formatTON(item.payout_ton) }));
            } else {
                toast.success(t("roulette.reveal.queued_review"));
            }
            refreshBalance?.(r.balance_ton);
            await reload();
        } catch (e) {
            notifyError();
            toast.error(t("win_modal.sell_failed"), { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(null);
        }
    };

    const handleWithdraw = (item) => {
        if (busy) return;
        tapMedium();
        setWithdrawTarget(item);
    };

    const handleSellAllVisible = async () => {
        if (busy) return;
        const sellable = items.filter(i => i.status === "in_inventory");
        if (sellable.length === 0) return;
        const totalTon = sellable.reduce((s, i) => s + i.payout_ton, 0);
        if (!(await confirmAsync({
            title: t("collection.confirm_sell_all", {
                count: sellable.length, amount: formatTON(totalTon),
            }),
            confirmLabel: "Sell all",
            destructive: false,
        }))) return;
        setBusy("all");
        let success = 0, failed = 0;
        let lastBalNum = null;
        for (const it of sellable) {
            try {
                const r = await sellInventoryItem(it.id);
                lastBalNum = r.balance_ton;
                success++;
            } catch { failed++; }
        }
        if (success > 0) sfx.play("coin_drop", { volume: 0.75 });
        if (lastBalNum !== null) refreshBalance?.(lastBalNum);
        toast.success(
            failed
                ? t("win_modal.sold_count_with_failed", { count: success, failed })
                : t("win_modal.sold_count", { count: success, amount: formatTON(totalTon) })
        );
        await reload();
        setBusy(null);
    };

    const rarityChips = useMemo(() => {
        if (!totals) return RARITY_ORDER;
        return RARITY_ORDER.filter(r => (totals.count_by_rarity?.[r] || 0) > 0);
    }, [totals]);

    return (
        <main className="v-wrap" style={{ minHeight: "var(--app-vh, 100dvh)" }} data-testid="inventory-page">
            <div className="flex items-baseline justify-between mb-3" style={{ marginTop: 6 }}>
                <h1 className="v-disp" style={{ font: "600 22px 'Space Grotesk'" }}>{t("collection.title")}</h1>
                <div className="flex items-center gap-2">
                    <Link
                        to="/withdrawals"
                        data-testid="inv-withdrawals-link"
                        className="inline-flex items-center gap-1"
                        style={{ font: "700 10px 'Inter'", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--v-gold)" }}
                    >
                        {t("collection.withdrawals_link")} <ChevronRight className="w-3 h-3" />
                    </Link>
                    <button onClick={reload} className="p-1" style={{ color: "var(--v-muted-2)", background: "none", border: 0, cursor: "pointer" }} data-testid="inv-refresh-btn" aria-label={t("collection.refresh_aria")}>
                        <RefreshCcw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Withdraw CTA */}
            <Link to="/withdrawals" data-testid="withdraw-cta" className="v-prow" style={{ marginBottom: 10 }}>
                <div className="ic"><ArrowUpRight className="w-5 h-5" /></div>
                <div className="tx">
                    <b>{t("inventory.withdraw_cta_title")}</b>
                    <span>{t("inventory.withdraw_cta_subtitle")}</span>
                </div>
                <ChevronRight className="w-4 h-4 ch" />
            </Link>

            {/* Telegram Gift Deposit CTA */}
            <button data-testid="gift-deposit-cta" onClick={() => setGiftDepositOpen(true)} className="v-prow" style={{ width: "100%", marginBottom: 16, cursor: "pointer" }}>
                <div className="ic" style={{ color: "var(--v-emerald)" }}><Gift className="w-5 h-5" /></div>
                <div className="tx text-left">
                    <b>{t("gift_deposit.cta_title")}</b>
                    <span>{t("gift_deposit.cta_subtitle")}</span>
                </div>
                <ChevronRight className="w-4 h-4 ch" />
            </button>

            <div className="grid grid-cols-2 gap-2 mb-4" data-testid="inv-totals">
                <div className="v-balcard" style={{ padding: 12 }}>
                    <div className="v-ballbl inline-flex items-center gap-1" style={{ color: "var(--v-gold)" }}>
                        <Trophy className="w-3 h-3" /> {t("collection.owned_value")}
                    </div>
                    <div className="v-disp" style={{ font: "800 20px 'Space Grotesk'", marginTop: 2 }}>
                        {formatTON(totals?.total_value_unsold_ton)}
                        <span style={{ font: "700 10px 'Inter'", color: "var(--v-muted-2)", marginLeft: 4 }}>TON</span>
                    </div>
                </div>
                <div className="v-balcard" style={{ padding: 12 }}>
                    <div className="v-ballbl inline-flex items-center gap-1">
                        <History className="w-3 h-3" /> {t("collection.all_time_won")}
                    </div>
                    <div className="v-disp" style={{ font: "800 20px 'Space Grotesk'", marginTop: 2 }}>
                        {formatTON(totals?.total_value_all_time_ton)}
                        <span style={{ font: "700 10px 'Inter'", color: "var(--v-muted-2)", marginLeft: 4 }}>TON</span>
                    </div>
                </div>
            </div>

            <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
                {STATUS_TABS.map((tab) => {
                    const n = totals?.count_by_status?.[tab.value] ?? (tab.value === "all" ? totals?.total_count : 0);
                    return (
                        <button
                            key={tab.value}
                            data-testid={`inv-tab-${tab.value}`}
                            onClick={() => setStatus(tab.value)}
                            className={`v-fchip inline-flex items-center gap-1${status === tab.value ? " on" : ""}`}
                            style={{ whiteSpace: "nowrap" }}
                        >
                            {tab.label}
                            {totals && n > 0 && (
                                <span style={{ opacity: status === tab.value ? 0.85 : 0.5 }}>{n}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-wrap gap-1.5 items-center mb-4 text-xs">
                <select
                    data-testid="inv-rarity-select"
                    value={rarity}
                    onChange={(e) => setRarity(e.target.value)}
                    className="v-select"
                >
                    <option value="all">{t("collection.all_rarities")}</option>
                    {rarityChips.map((r) => (
                        <option key={r} value={r} style={{ color: RARITY_HEX[r] }}>
                            {t(`rarity.${r}`)} · {totals?.count_by_rarity?.[r] || 0}
                        </option>
                    ))}
                </select>
                <select
                    data-testid="inv-case-select"
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className="v-select"
                >
                    <option value="all">{t("collection.all_cases")}</option>
                    {cases.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <select
                    data-testid="inv-sort-select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="v-select ml-auto"
                >
                    {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            {status === "in_inventory" && items.length > 0 && (
                <button
                    data-testid="inv-sell-all-btn"
                    onClick={handleSellAllVisible}
                    disabled={busy === "all"}
                    className="v-cta v-wide v-sm mb-3"
                >
                    <Wallet className="w-3 h-3" /> {t("collection.sell_all_visible", { count: items.length })}
                </button>
            )}

            {loading ? (
                <div className="py-10 text-center text-white/40 text-sm inline-flex items-center justify-center gap-2 w-full">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t("collection.loading")}
                </div>
            ) : items.length === 0 ? (
                <div className="py-16 text-center" data-testid="inv-empty">
                    <div className="text-sm text-white/50">{t("collection.empty_title")}</div>
                    <div className="text-xs text-white/35 mt-1">
                        {status === "in_inventory"
                            ? t("collection.empty_owned")
                            : t("collection.empty_other")}
                    </div>
                </div>
            ) : (
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="inv-grid">
                    {items.map((it, i) => {
                        const isListed = it.marketplace_status === "on_sale";
                        const itemForCard = {
                            id: it.id, item_name: it.item_name, item_slug: it.item_slug,
                            image_url: it.image_url, rarity: it.rarity, payout_ton: it.payout_ton,
                        };
                        // Fix-H state slot: Listed → cancel CTA; in_inventory & off_sale → 3-CTA row
                        const actionSlot = it.status !== "in_inventory" ? null : isListed ? (
                            <div className="flex flex-col gap-1" data-testid={`inv-listed-${it.id}`}>
                                <button
                                    data-testid={`inv-cancel-listing-${it.id}`}
                                    disabled={busy === it.id}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelListing(it); }}
                                    className="text-[9px] font-black uppercase tracking-wider bg-white/5 border border-gold-500/20 hover:bg-gold-500/10 text-gold-200 rounded-md py-1.5 disabled:opacity-50"
                                >
                                    {t("inventory.list.cancel_listing")}
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-1">
                                <button
                                    data-testid={`inv-quicksell-${it.id}`}
                                    disabled={busy === it.id}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSell(it); }}
                                    className="text-[9px] font-black uppercase tracking-wider bg-gradient-to-b from-gold-300 to-gold-500 text-zinc-950 rounded-md py-1.5 disabled:opacity-50"
                                >
                                    {t("inventory.list.quick_sell")}
                                </button>
                                <button
                                    data-testid={`inv-list-market-${it.id}`}
                                    disabled={busy === it.id}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); openListModal(it); }}
                                    className="text-[9px] font-black uppercase tracking-wider bg-gold-bright/15 border border-gold-bright/40 text-gold-bright hover:bg-gold-bright/25 rounded-md py-1.5 disabled:opacity-50"
                                >
                                    {t("inventory.list.list_market")}
                                </button>
                                <button
                                    data-testid={`inv-withdraw-${it.id}`}
                                    disabled={busy === it.id}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleWithdraw(it); }}
                                    className="text-[9px] font-black uppercase tracking-wider bg-white/5 border border-white/15 hover:bg-white/10 transition text-white rounded-md py-1.5 disabled:opacity-50"
                                >
                                    {t("collection.withdraw")}
                                </button>
                            </div>
                        );
                        return (
                            <motion.div
                                key={it.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.025, duration: 0.3 }}
                                data-testid={`inv-tile-${it.id}`}
                                className="min-w-0"
                            >
                                <GiftCard
                                    item={itemForCard}
                                    size="md"
                                    state={isListed ? "listed" : (it.status !== "in_inventory" ? "locked" : "idle")}
                                    actionSlot={actionSlot}
                                    className="!w-full"
                                />
                            </motion.div>
                        );
                    })}
                </div>
            )}
            <WithdrawModal
                item={withdrawTarget}
                open={!!withdrawTarget}
                onClose={() => setWithdrawTarget(null)}
                onConfirmed={() => { reload(); }}
            />
            <GiftDepositModal
                open={giftDepositOpen}
                onClose={() => setGiftDepositOpen(false)}
                onFulfilled={() => { reload(); }}
            />
            {/* Fix-F: List on Market modal */}
            <AnimatePresence>
                {listTarget && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={closeListModal}
                        transition={{ duration: PRM() ? 0 : 0.18 }}
                        className="fixed inset-0 z-[60] bg-zinc-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                        data-testid="inv-list-modal"
                    >
                        <motion.div
                            initial={PRM() ? false : { y: 28, opacity: 0, scale: 0.97 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={PRM() ? { opacity: 0 } : { y: 16, opacity: 0 }}
                            transition={{ type: "spring", damping: 26, stiffness: 280 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-sm rounded-2xl bg-zinc-900 border border-amber-400/30 overflow-hidden"
                        >
                            <button type="button" onClick={closeListModal}
                                className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-white/5 text-white/55 hover:text-white transition-colors"
                                aria-label={t("inventory.list.close_aria")}
                                data-testid="inv-list-modal-close">
                                <X className="w-4 h-4" aria-hidden="true"/>
                            </button>
                            <div className="px-5 pt-5 pb-3 border-b border-white/8">
                                <div className="flex items-center gap-2 mb-1">
                                    <ShoppingBag className="w-4 h-4 text-amber-300" />
                                    <span className="text-[10px] uppercase tracking-[0.32em] text-amber-300 font-bold">
                                        {t("inventory.list.title_tag")}
                                    </span>
                                </div>
                                <h2 className="text-xl font-bold text-white">{t("inventory.list.title")}</h2>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/8 px-2.5 py-2">
                                    <div className="relative w-12 h-12 rounded overflow-hidden bg-black border border-white/10 shrink-0">
                                        <img src={resolveImage(listTarget.image_path)} alt=""
                                            className="absolute inset-0 w-full h-full object-cover"
                                            onError={(e) => { e.currentTarget.style.opacity = "0"; }}/>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-white truncate">{listTarget.item_name || listTarget.item_slug}</div>
                                        <div className="text-[10px] text-white/55 font-mono">
                                            {t("inventory.list.base_value")}: {formatTON(listTarget.payout_ton)} TON
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">
                                        {t("inventory.list.price_label")}
                                    </label>
                                    <input
                                        type="number" step="0.1" min="0.1"
                                        value={listPrice}
                                        onChange={(e) => setListPrice(e.target.value)}
                                        inputMode="decimal"
                                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono text-base"
                                        data-testid="inv-list-price-input"
                                        autoFocus
                                    />
                                    <div className="text-[10px] text-white/40 font-mono mt-1" data-testid="inv-list-bounds-hint">
                                        {t("inventory.list.bounds_hint", {
                                            min: marketConfig.min_price_ton,
                                            max: marketConfig.max_price_ton,
                                        })}
                                    </div>
                                </div>
                                {(() => {
                                    const p = parseFloat(listPrice) || 0;
                                    const feeBps = Math.max(0, 500 - vipDiscountBps);
                                    const fee = +(p * feeBps / 10000).toFixed(4);
                                    const net = +(p - fee).toFixed(4);
                                    return (
                                        <div className="rounded-lg bg-emerald-500/8 border border-emerald-400/25 px-3 py-2 text-xs"
                                             data-testid="inv-list-fee-preview">
                                            <div className="flex justify-between text-white/65">
                                                <span>{t("inventory.list.fee")} ({(feeBps/100).toFixed(2)}%{vipDiscountBps>0?" · VIP":""})</span>
                                                <span className="font-mono">{fee.toFixed(4)} TON</span>
                                            </div>
                                            <div className="flex justify-between mt-1 font-bold">
                                                <span className="text-white/80">{t("inventory.list.you_receive")}</span>
                                                <span className="font-mono text-emerald-300">{net.toFixed(4)} TON</span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="px-5 pb-5 flex gap-2">
                                <button type="button" onClick={closeListModal}
                                    className="flex-1 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm font-bold hover:text-white"
                                    data-testid="inv-list-cancel">
                                    {t("inventory.list.cancel")}
                                </button>
                                <button type="button" onClick={submitListing} disabled={listingBusy}
                                    className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 text-zinc-950 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-1.5"
                                    data-testid="inv-list-confirm">
                                    {listingBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Tag className="w-3.5 h-3.5"/>}
                                    {t("inventory.list.confirm")}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
};
