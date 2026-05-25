import React, { useEffect, useState, useCallback } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@/lib/i18n";  // must run before any t() call
import { useTranslation } from "react-i18next";
import "@/App.css";
import { Toaster, toast } from "sonner";

import { Header, BottomNav } from "@/components/Header";
import { AppShell } from "@/components/AppShell";
import { DepositModal } from "@/components/DepositModal";
import { DepositChoiceModal } from "@/components/DepositChoiceModal";
import { OutOfTelegram } from "@/components/OutOfTelegram";
import { CasesListPage } from "@/pages/CasesListPage";
import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { FriendsPage } from "@/pages/FriendsPage";
import { WithdrawalsPage } from "@/pages/WithdrawalsPage";
import ProfilePage from "@/pages/ProfilePage";
import { AdminWithdrawalsPage } from "@/pages/AdminWithdrawalsPage";
import { AdminCasesPage } from "@/pages/AdminCasesPage";
import { AdminItemsPage } from "@/pages/AdminItemsPage";
import { AdminSettingsPage } from "@/pages/AdminSettingsPage";
import { AdminPromosPage } from "@/pages/AdminPromosPage";
import { AdminDigestPage } from "@/pages/AdminDigestPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import { AdminSellReviewsPage } from "@/pages/AdminSellReviewsPage";
import { AdminRouletteConfigPage } from "@/pages/AdminRouletteConfigPage";
import { LeaderboardPage } from "@/pages/LeaderboardPage";
import RoulettePage from "@/pages/RoulettePage";
import BattlesLobbyPage from "@/pages/BattlesLobbyPage";
import BattleArenaPage from "@/pages/BattleArenaPage";
import CrashPage from "@/pages/CrashPage";
import WheelPage from "@/pages/WheelPage";
import BattlePassPage from "@/pages/BattlePassPage";
// Phase 8
import PlinkoPage from "@/pages/PlinkoPage";
import MinesPage from "@/pages/MinesPage";
import MissionsPage from "@/pages/MissionsPage";
import AchievementsPage from "@/pages/AchievementsPage";
// Phase 9
import MarketplacePage from "@/pages/MarketplacePage";
import VipPage from "@/pages/VipPage";
import AdminTonapiMappingsPage from "@/pages/AdminTonapiMappingsPage";
import { AdminLayout } from "@/components/AdminSubnav";
import { DevCreditFab } from "@/components/DevCreditFab";
import { AchievementWatcher } from "@/components/AchievementWatcher";
import { ConfirmRoot } from "@/components/common/confirmDialog";
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
    const { t } = useTranslation();
    const [bootState, setBootState] = useState("loading");
    const [user, setUser] = useState(null);
    const [balance, setBalance] = useState(0);
    const [depositOpen, setDepositOpen] = useState(false);
    // Phase 11.2.6 — DepositChoiceModal is the new single entry point from
    // the header balance widget. It then routes the user to either the
    // existing on-chain DepositModal or the TonConnect connect/disconnect
    // flow. Removes the previous duplicate "balance pill + yellow Connect
    // Wallet button" cluster that users were misreading as two competing CTAs.
    const [choiceOpen, setChoiceOpen] = useState(false);

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
                toast.error(t("auth.telegram_failed"), {
                    description: e?.response?.data?.detail || e?.message,
                });
            }
        }

        if (isDevMode()) {
            try {
                // Allow operator to pass ?telegram_id=… for admin dev-testing.
                const qpTid = new URLSearchParams(window.location.search).get("telegram_id");
                const qpUser = new URLSearchParams(window.location.search).get("username");
                const tid = qpTid ? parseInt(qpTid, 10) : (100000 + Math.floor(Math.random() * 900000));
                const uname = qpUser || `dev_${tid}`;
                const { user: u } = await authDevLogin(tid, uname, "Dev");
                setUser(u);
                setBalance(Number(u.balance_ton || 0));
                setBootState("ready");
                return;
            } catch (e) {
                toast.error(t("auth.dev_failed"), { description: e?.message });
            }
        }

        setBootState("out");
    }, [t]);

    useEffect(() => {
        boot();
        // Phase 11.5-A — kick off SFX preload on app boot. The helper
        // listens for the first user gesture (which is also what iOS
        // Telegram WebView requires to unblock <audio> autoplay) and
        // additionally fires on requestIdleCallback so desktop browsers
        // that never receive a gesture still warm the audio cache.
        try {
            // Lazy import to keep the React-strict-mode boot path tiny
            // and avoid a hard dep on the sound module in tests.
            // eslint-disable-next-line global-require
            require("@/lib/sound").schedulePreload?.();
        } catch {}
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
                    <span className="font-display font-bold tracking-[0.2em] text-sm uppercase">
                        {t("boot.connecting")}
                    </span>
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
                <AppShell
                    user={user}
                    mobileHeader={
                        <Header
                            user={user}
                            balance={balance}
                            onLogout={handleLogout}
                            onOpenDeposit={() => setChoiceOpen(true)}
                        />
                    }
                    mobileNav={<BottomNav isAdmin={!!user?.is_admin} />}
                >
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
                            path="/profile"
                            element={<ProfilePage user={user} balance={balance} onLogout={handleLogout} />}
                        />
                        <Route
                            path="/leaderboard"
                            element={<LeaderboardPage />}
                        />
                        <Route
                            path="/roulette"
                            element={<RoulettePage user={user} refreshBalance={refreshBalance} />}
                        />
                        <Route
                            path="/battles"
                            element={<BattlesLobbyPage user={user} refreshBalance={refreshBalance} />}
                        />
                        <Route
                            path="/battles/:battleId"
                            element={<BattleArenaPage user={user} refreshBalance={refreshBalance} />}
                        />
                        <Route
                            path="/crash"
                            element={<CrashPage user={user} balance={balance} refreshBalance={refreshBalance} />}
                        />
                        <Route
                            path="/wheel"
                            element={<WheelPage user={user} balance={balance} refreshBalance={refreshBalance} />}
                        />
                        {/* Phase 7c — Battle Pass / Seasons. Two paths same component. */}
                        <Route
                            path="/battlepass"
                            element={<BattlePassPage user={user} balance={balance} refreshBalance={refreshBalance} />}
                        />
                        <Route
                            path="/season"
                            element={<BattlePassPage user={user} balance={balance} refreshBalance={refreshBalance} />}
                        />
                        {/* Phase 8 — Plinko, Mines, Missions, Achievements */}
                        <Route path="/plinko"        element={<PlinkoPage       user={user} balance={balance} refreshBalance={refreshBalance} />} />
                        <Route path="/mines"         element={<MinesPage        user={user} balance={balance} refreshBalance={refreshBalance} />} />
                        <Route path="/missions"      element={<MissionsPage     user={user} refreshBalance={refreshBalance} />} />
                        <Route path="/achievements"  element={<AchievementsPage user={user} refreshBalance={refreshBalance} />} />
                        {/* Phase 9 — Marketplace + VIP */}
                        <Route path="/market"        element={<MarketplacePage user={user} balance={balance} refreshBalance={refreshBalance} />} />
                        <Route path="/vip"           element={<VipPage         user={user} refreshBalance={refreshBalance} />} />
                        {/* Phase 6e bug-fix — admin routes registered unconditionally; AdminLayout itself
                            gates content rendering on user.is_admin so non-admins see a clear notice
                            instead of "No routes matched" → blank page. */}
                        <Route path="/admin" element={<AdminLayout isAdmin={!!user?.is_admin} />}>
                            <Route index element={<AdminWithdrawalsPage />} />
                            <Route path="cases" element={<AdminCasesPage />} />
                            <Route path="items" element={<AdminItemsPage />} />
                            <Route path="settings" element={<AdminSettingsPage />} />
                            <Route path="promos" element={<AdminPromosPage />} />
                            <Route path="digest" element={<AdminDigestPage />} />
                            <Route path="users" element={<AdminUsersPage />} />
                            <Route path="sell-reviews" element={<AdminSellReviewsPage />} />
                            <Route path="roulette-config" element={<AdminRouletteConfigPage />} />
                            <Route path="tonapi-mappings" element={<AdminTonapiMappingsPage />} />
                        </Route>
                    </Routes>
                </AppShell>

                <DevCreditFab onCredited={(b) => setBalance(b)} />

                {/* Phase 10.3 — Global mid-session achievement-unlock toaster */}
                <AchievementWatcher user={user} />

                {/* Fix-I — App-wide shadcn confirm dialog (replaces window.confirm) */}
                <ConfirmRoot />

                <DepositModal
                    open={depositOpen}
                    onClose={() => setDepositOpen(false)}
                    currentBalance={balance}
                    onCredited={(b) => setBalance(b)}
                />

                {/* Phase 11.2.6 — choice modal opened from header balance widget.
                    Routes either to TonConnect connect/disconnect (handled
                    internally via @tonconnect/ui-react hooks) or to the
                    on-chain DepositModal above. */}
                <DepositChoiceModal
                    open={choiceOpen}
                    onClose={() => setChoiceOpen(false)}
                    onChooseDeposit={() => setDepositOpen(true)}
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
