import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Copy, Diamond, Gift, Wallet, Share2, Users } from "lucide-react";
import { fetchReferrals, claimReferrals, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { PromoRedeemField } from "@/components/PromoRedeemField";

export const FriendsPage = ({ refreshBalance }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState(false);

    const reload = async () => {
        setLoading(true);
        try {
            setData(await fetchReferrals());
        } catch (e) {
            toast.error("Couldn't load referrals", { description: e?.message });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { reload(); }, []);

    const copy = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(`${label} copied`, { duration: 1500 });
        } catch {
            toast.error("Copy failed");
        }
    };

    const handleClaim = async () => {
        if (claiming || !data || data.claimable_ton <= 0) return;
        setClaiming(true);
        try {
            const r = await claimReferrals();
            toast.success(`+${formatTON(r.claimed_ton)} TON claimed`, {
                description: "Moved to main balance.",
            });
            refreshBalance?.(r.new_main_balance);
            await reload();
        } catch (e) {
            toast.error("Claim failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setClaiming(false);
        }
    };

    const handleShare = async () => {
        if (!data) return;
        const text = `🎰 Open TON cases with me on Lydomania — TG NFT gifts inside!\n${data.ref_link}`;
        const tg = window.Telegram?.WebApp;
        if (tg?.openTelegramLink) {
            tg.openTelegramLink(
                `https://t.me/share/url?url=${encodeURIComponent(data.ref_link)}&text=${encodeURIComponent(
                    "🎰 Open TON cases with me on Lydomania — TG NFT gifts inside!"
                )}`
            );
        } else {
            await copy(text, "Invite text");
        }
    };

    if (loading || !data) {
        return (
            <main className="min-h-[60vh] flex items-center justify-center text-white/50">
                <span className="text-sm">Loading…</span>
            </main>
        );
    }

    return (
        <main data-testid="friends-page" className="max-w-[430px] mx-auto px-4 pt-3 pb-24 space-y-5">
            <div>
                <h1 className="font-display text-2xl font-black tracking-tight">Friends</h1>
                <p className="text-xs text-white/50 mt-1">
                    Earn <span className="font-bold text-cyber-cyan">{Math.round((data.referral_pct || 0.05) * 100)}%</span> of every TON your friends wager — forever.
                </p>
            </div>

            {/* Phase 4b — Promo code redeem */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-bold text-emerald-200/85">
                    <Gift className="w-3 h-3" />
                    Got a promo code?
                </div>
                <PromoRedeemField onRedeemed={() => refreshBalance?.()} />
            </div>

            {/* Earnings tiles */}
            <div className="grid grid-cols-2 gap-2">
                <div
                    data-testid="ref-earnings-tile"
                    className="rounded-xl border border-cyber-cyan/30 bg-gradient-to-br from-cyber-cyan/10 to-cyber-purple/10 p-3"
                >
                    <div className="text-[9px] uppercase font-bold tracking-[0.2em] text-cyber-cyan inline-flex items-center gap-1">
                        <Gift className="w-3 h-3" /> Claimable
                    </div>
                    <div className="font-display text-xl font-black mt-0.5 tabular-nums text-white">
                        {formatTON(data.claimable_ton)}
                        <span className="text-[10px] text-white/40 ml-1 font-bold">TON</span>
                    </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-cyber-surface/60 p-3">
                    <div className="text-[9px] uppercase font-bold tracking-[0.2em] text-white/50 inline-flex items-center gap-1">
                        <Wallet className="w-3 h-3" /> Earned all-time
                    </div>
                    <div className="font-display text-xl font-black mt-0.5 tabular-nums text-white">
                        {formatTON(data.total_earnings_ton)}
                        <span className="text-[10px] text-white/40 ml-1 font-bold">TON</span>
                    </div>
                </div>
            </div>

            <button
                data-testid="ref-claim-btn"
                disabled={data.claimable_ton <= 0 || claiming}
                onClick={handleClaim}
                className="w-full bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-display font-black text-sm rounded-xl px-4 py-3 uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
                <Wallet className="w-4 h-4" /> Claim to main balance
            </button>

            {/* Ref code */}
            <section className="rounded-2xl border border-white/10 bg-cyber-surface p-4 space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Your invite code
                </div>
                <div
                    onClick={() => copy(data.ref_code, "Code")}
                    data-testid="ref-code-box"
                    className="font-mono text-2xl font-black text-cyber-cyan text-center py-3 bg-cyber-bg/80 rounded-xl border border-cyber-cyan/30 hover:border-cyber-cyan/70 cursor-pointer transition"
                >
                    {data.ref_code}
                </div>

                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 pt-1">
                    Invite link
                </div>
                <div
                    onClick={() => copy(data.ref_link, "Link")}
                    data-testid="ref-link-box"
                    className="bg-cyber-bg/80 rounded-xl border border-white/10 px-3 py-2 font-mono text-[11px] text-white/70 truncate cursor-pointer hover:border-cyber-cyan/30 transition flex items-center gap-2"
                >
                    <span className="truncate flex-1">{data.ref_link}</span>
                    <Copy className="w-3.5 h-3.5 text-cyber-cyan flex-shrink-0" />
                </div>

                <button
                    data-testid="ref-share-btn"
                    onClick={handleShare}
                    className="w-full bg-white/5 border border-white/15 hover:bg-white/10 transition text-white font-display font-bold text-sm rounded-xl px-4 py-3 uppercase tracking-wide inline-flex items-center justify-center gap-2"
                >
                    <Share2 className="w-4 h-4" /> Share invite
                </button>
            </section>

            {/* Referred users */}
            <section data-testid="ref-list">
                <div className="flex items-baseline justify-between mb-2">
                    <h2 className="font-display text-base font-bold tracking-tight">
                        Your referrals
                    </h2>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-white/40 inline-flex items-center gap-1">
                        <Users className="w-3 h-3" /> {data.total_referrals_count} total
                    </span>
                </div>
                {data.recent_referrals.length === 0 ? (
                    <div className="text-center text-white/35 text-xs py-8">
                        No referrals yet. Share your code above.
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {data.recent_referrals.map((r, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className="flex items-center justify-between bg-cyber-surface/60 border border-white/10 rounded-lg px-3 py-2"
                            >
                                <div className="text-sm font-mono text-white/80 truncate">
                                    @{r.masked_username}
                                </div>
                                <div className="flex items-center gap-3 text-[10px]">
                                    <span className="text-white/50 inline-flex items-center gap-1">
                                        <Diamond className="w-3 h-3 text-white/40" />
                                        {formatTON(r.total_wagered_ton)} wagered
                                    </span>
                                    <span className="text-cyber-cyan font-bold tabular-nums">
                                        +{formatTON(r.your_earnings_ton)}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
};
