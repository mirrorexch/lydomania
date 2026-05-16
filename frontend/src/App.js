import React, { useEffect, useState, useCallback } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@/App.css";
import { Toaster, toast } from "sonner";

import { Header, BottomNav } from "@/components/Header";
import { DepositModal } from "@/components/DepositModal";
import { OutOfTelegram } from "@/components/OutOfTelegram";
import { CasesListPage } from "@/pages/CasesListPage";
import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { FriendsPage } from "@/pages/FriendsPage";
import { WithdrawalsPage } from "@/pages/WithdrawalsPage";
import { AdminWithdrawalsPage } from "@/pages/AdminWithdrawalsPage";
import { AdminCasesPage } from "@/pages/AdminCasesPage";
import { AdminItemsPage } from "@/pages/AdminItemsPage";
import { AdminSettingsPage } from "@/pages/AdminSettingsPage";
import { AdminPromosPage } from "@/pages/AdminPromosPage";          // Phase 4b
import { AdminDigestPage } from "@/pages/AdminDigestPage";          // Phase 4b
import { LeaderboardPage } from "@/pages/LeaderboardPage";          // Phase 4b
import { AdminLayout } from "@/components/AdminSubnav";
import { DevCreditFab } from "@/components/DevCreditFab";
import {
    authTelegram,
    authDevLogin,
    fetchMe,
    fetchBalance,
    tokenStore,
} from "@/lib/api";
import {
    getInitData,
    isInTelegram,
    isDevMode,
    tgReady,
} from "@/lib/telegram";

function App() {
    const [bootState, setBootState] = useState("loading");
    const [user, setUser] = useState(null);
    const [balance, setBalance] = useState(0);
    const [depositOpen, setDepositOpen] = useState(false);

    const boot = useCallback(async () => {
        tgReady();

        if (tokenStore.get()) {
            try {
                const me = await fetchMe();
                setUser(me);
                setBalance(Number(me.balance_ton || 0));
                setBootState("ready");
                return;
            } catch {
                tokenStore.clear();
            }
        }

        const initData = getInitData();
        if (initData && isInTelegram()) {
            try {
                const { user: u } = await authTelegram(initData);
                setUser(u);
                setBalance(Number(u.balance_ton || 0));
                setBootState("ready");
                return;
            } catch (e) {
                toast.error("Telegram auth failed", {
                    description: e?.response?.data?.detail || e?.message,
                });
            }
        }

        if (isDevMode()) {
            try {
                const tid = 100000 + Math.floor(Math.random() * 900000);
                const { user: u } = await authDevLogin(tid, `dev_${tid}`, "Dev");
                setUser(u);
                setBalance(Number(u.balance_ton || 0));
                setBootState("ready");
                return;
            } catch (e) {
                toast.error("Dev login failed", { description: e?.message });
            }
        }

        setBootState("out");
    }, []);

    useEffect(() => {
        boot();
    }, [boot]);

    const handleDevBypass = () => {
        const url = new URL(window.location.href);
        url.searchParams.set("dev", "1");
        window.location.href = url.toString();
    };

    const handleLogout = () => {
        tokenStore.clear();
        setUser(null);
        setBalance(0);
        setBootState("out");
    };

    const refreshBalance = useCallback(async (preset) => {
        if (typeof preset === "number") { setBalance(preset); return; }
        try {
            const b = await fetchBalance();
            setBalance(b);
        } catch { /* noop */ }
    }, []);

    if (bootState === "loading") {
        return (
            <div data-testid="boot-loading" className="min-h-screen flex items-center justify-center cyber-grid-bg">
                <div className="flex items-center gap-3 text-white/60">
                    <div className="w-3 h-3 rounded-full bg-cyber-cyan animate-shimmer" />
                    <span className="font-display font-bold tracking-[0.2em] text-sm uppercase">Connecting…</span>
                </div>
            </div>
        );
    }

    if (bootState === "out") {
        return <OutOfTelegram onDevBypass={handleDevBypass} />;
    }

    return (
        <BrowserRouter>
            <div data-testid="app-root" className="min-h-screen cyber-grid-bg">
                <Header
                    user={user}
                    balance={balance}
                    onLogout={handleLogout}
                    onOpenDeposit={() => setDepositOpen(true)}
                />

                <Routes>
                    <Route path="/" element={<CasesListPage balance={balance} />} />
                    <Route
                        path="/case/:id"
                        element={<CaseDetailPage balance={balance} refreshBalance={refreshBalance} />}
                    />
                    <Route
                        path="/cases/:id"
                        element={<CaseDetailPage balance={balance} refreshBalance={refreshBalance} />}
                    />
                    <Route
                        path="/inventory"
                        element={<InventoryPage refreshBalance={refreshBalance} />}
                    />
                    <Route
                        path="/friends"
                        element={<FriendsPage refreshBalance={refreshBalance} />}
                    />
                    <Route
                        path="/withdrawals"
                        element={<WithdrawalsPage />}
                    />
                    <Route
                        path="/leaderboard"
                        element={<LeaderboardPage />}
                    />
                    {user?.is_admin && (
                        <Route path="/admin" element={<AdminLayout />}>
                            <Route index element={<AdminWithdrawalsPage />} />
                            <Route path="cases" element={<AdminCasesPage />} />
                            <Route path="items" element={<AdminItemsPage />} />
                            <Route path="settings" element={<AdminSettingsPage />} />
                            <Route path="promos" element={<AdminPromosPage />} />
                            <Route path="digest" element={<AdminDigestPage />} />
                        </Route>
                    )}
                </Routes>

                <BottomNav isAdmin={!!user?.is_admin} />
                <DevCreditFab onCredited={(b) => setBalance(b)} />

                <DepositModal
                    open={depositOpen}
                    onClose={() => setDepositOpen(false)}
                    currentBalance={balance}
                    onCredited={(b) => setBalance(b)}
                />

                <Toaster
                    theme="dark"
                    position="top-center"
                    toastOptions={{
                        style: {
                            background: "#0F0F13",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff",
                        },
                    }}
                />
            </div>
        </BrowserRouter>
    );
}

export default App;
