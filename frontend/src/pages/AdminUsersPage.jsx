/**
 * Phase 6a hotfix — admin page to manually credit a player's TON balance.
 *
 * Flow:
 *   1. Operator pastes a telegram_id → click "Lookup" → see current balance + username.
 *   2. Type amount + reason → click "Credit" → balance updates with a toast.
 *   3. Audit history of recent credits for that user is shown below.
 *
 * Backed by:
 *   GET  /api/admin/users/lookup?telegram_id=…
 *   POST /api/admin/users/{telegram_id}/credit
 *   GET  /api/admin/users/{telegram_id}/credits
 */
import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { http } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, CircleDollarSign, Wallet, History } from "lucide-react";
import { formatTON } from "@/lib/rarity";

export default function AdminUsersPage() {
    const [tgId, setTgId] = useState("");
    const [user, setUser] = useState(null);          // { found, user? }
    const [amount, setAmount] = useState("");
    const [reason, setReason] = useState("test credit");
    const [credits, setCredits] = useState([]);
    const [busy, setBusy] = useState(false);
    const [loadingLookup, setLoadingLookup] = useState(false);

    const lookup = useCallback(async () => {
        const id = parseInt(tgId, 10);
        if (!id || id <= 0) {
            toast.error("Enter a valid telegram_id");
            return;
        }
        setLoadingLookup(true);
        try {
            const { data } = await http.get("/admin/users/lookup", { params: { telegram_id: id } });
            setUser(data);
            if (data.found) {
                const hist = await http.get(`/admin/users/${id}/credits`);
                setCredits(hist.data?.rows || []);
            } else {
                setCredits([]);
                toast.error(`User ${id} not found · must /start the bot first`);
            }
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Lookup failed");
        } finally {
            setLoadingLookup(false);
        }
    }, [tgId]);

    const credit = useCallback(async () => {
        const id = parseInt(tgId, 10);
        const amt = parseFloat(amount);
        if (!id || !amt || amt <= 0) {
            toast.error("Enter a valid telegram_id and positive amount");
            return;
        }
        setBusy(true);
        try {
            const { data } = await http.post(`/admin/users/${id}/credit`, {
                amount_ton: amt,
                reason: reason || "manual_credit",
            });
            toast.success(`+${formatTON(data.amount_ton)} TON → @${data.username || data.telegram_id} · new bal ${formatTON(data.balance_after)} TON`);
            setUser((u) => ({ ...u, user: { ...(u?.user || {}), balance_ton: data.balance_after } }));
            setAmount("");
            // Refresh history
            const hist = await http.get(`/admin/users/${id}/credits`);
            setCredits(hist.data?.rows || []);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Credit failed");
        } finally {
            setBusy(false);
        }
    }, [tgId, amount, reason]);

    const u = user?.user;

    return (
        <div className="px-4 lg:px-6 py-6 max-w-3xl mx-auto space-y-5" data-testid="admin-users-page">
            <header className="space-y-1">
                <h1 className="text-2xl font-extrabold tracking-tight">Manual credits</h1>
                <p className="text-sm text-white/60">
                    Credit a user's TON balance. Every credit is logged to <code className="text-cyan-300">manual_credits</code> for audit.
                </p>
            </header>

            <Card className="bg-white/[0.03] border-white/10 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 min-w-0">
                        <label className="text-xs uppercase tracking-wide text-white/50">Telegram ID</label>
                        <Input
                            data-testid="admin-credit-tg-input"
                            type="number"
                            value={tgId}
                            onChange={(e) => setTgId(e.target.value)}
                            placeholder="e.g. 1862754938"
                            className="mt-1 bg-black/40 border-white/10"
                        />
                    </div>
                    <Button
                        data-testid="admin-credit-lookup-btn"
                        onClick={lookup}
                        disabled={loadingLookup}
                        className="sm:self-end bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
                    >
                        {loadingLookup ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                        Lookup
                    </Button>
                </div>

                {user && !user.found && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm p-3">
                        User <strong>{user.telegram_id}</strong> not found. They must <code>/start</code> the bot first.
                    </div>
                )}

                {u && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" data-testid="admin-credit-user-info">
                        <div className="flex items-center gap-2 text-emerald-200">
                            <Wallet className="w-4 h-4" />
                            <span className="font-semibold">@{u.username || "no-username"}</span>
                            <span className="text-white/40">·</span>
                            <span>{u.first_name}</span>
                        </div>
                        <div className="text-white/60">tg_id <code>{u.telegram_id}</code></div>
                        <div className="text-white">Balance: <strong className="text-cyan-300">{formatTON(u.balance_ton || 0)} TON</strong></div>
                    </div>
                )}
            </Card>

            {u && (
                <Card className="bg-white/[0.03] border-white/10 p-5 space-y-4">
                    <h2 className="font-bold flex items-center gap-2"><CircleDollarSign className="w-4 h-4 text-yellow-400" /> Credit amount</h2>
                    <div className="grid sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-1">
                            <label className="text-xs uppercase tracking-wide text-white/50">Amount (TON)</label>
                            <Input
                                data-testid="admin-credit-amount-input"
                                type="number"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="3000"
                                className="mt-1 bg-black/40 border-white/10"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="text-xs uppercase tracking-wide text-white/50">Reason (audit trail)</label>
                            <Input
                                data-testid="admin-credit-reason-input"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="test credit"
                                className="mt-1 bg-black/40 border-white/10"
                                maxLength={200}
                            />
                        </div>
                    </div>
                    <Button
                        data-testid="admin-credit-submit-btn"
                        onClick={credit}
                        disabled={busy || !amount}
                        className="w-full bg-gradient-to-r from-emerald-500 to-cyan-400 hover:from-emerald-400 hover:to-cyan-300 text-black font-bold"
                    >
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CircleDollarSign className="w-4 h-4 mr-2" />}
                        Credit user
                    </Button>
                </Card>
            )}

            {credits.length > 0 && (
                <Card className="bg-white/[0.03] border-white/10 p-5 space-y-3" data-testid="admin-credit-history">
                    <h2 className="font-bold flex items-center gap-2"><History className="w-4 h-4 text-white/60" /> Recent credits ({credits.length})</h2>
                    <div className="space-y-2 text-sm">
                        {credits.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-white/[0.03] px-3 py-2 border border-white/5">
                                <span className="text-emerald-300 font-bold">+{formatTON(c.amount_ton)} TON</span>
                                <span className="text-white/50">{new Date(c.created_at).toLocaleString()}</span>
                                <span className="text-white/70">{c.reason}</span>
                                <span className="text-white/40 ml-auto">by {c.admin}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
