import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useTonAddress } from "@tonconnect/ui-react";
import {
    Diamond, ArrowDownToLine, Swords, Disc3, Package, Trophy, Backpack, User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTON } from "@/lib/rarity";
import { SoundToggle } from "@/components/SoundToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { OnlineCounter } from "@/components/OnlineCounter";
import { RollingNumber } from "@/components/RollingNumber";
import SeasonHud from "@/components/season/SeasonHud";
import { VipBadge } from "@/components/VipBadge";
import { tapLight, tapMedium } from "@/lib/haptics";
import { sfx } from "@/lib/sound";

export const Header = ({ user, balance, onLogout, onOpenDeposit }) => {
    const { t } = useTranslation();
    const tonAddress = useTonAddress();
    const short = tonAddress
        ? `${tonAddress.slice(0, 4)}…${tonAddress.slice(-4)}`
        : null;

    return (
        <header
            data-testid="app-header"
            className="sticky top-0 z-40 w-full backdrop-blur-xl bg-cyber-bg/75 border-b border-white/5 px-3 py-3"
            style={{
                // Phase 11.2.7-A — push the header down by the Telegram chrome
                // safe-area top inset (Close × dropdown ⋯ 3-dots cluster), so
                // the app's profile pill / language toggle / sound / balance
                // widget are never overlapped by the Mini App chrome.
                // --tg-safe-top is set by tgReady() from
                // window.Telegram.WebApp.contentSafeAreaInset.top (Bot API 8.0+),
                // with env(safe-area-inset-top) as a CSS-level fallback when
                // the var hasn't been published yet (e.g. on first paint
                // before tgReady runs, or in a regular browser).
                paddingTop: "max(var(--tg-safe-top, 0px), env(safe-area-inset-top, 0px))",
            }}
        >
            <div className="max-w-[430px] lg:max-w-none mx-auto flex items-center justify-between gap-1.5 lg:gap-3 lg:px-2">
                {/* Profile pill — hidden at lg+ since brand lives in SideNav */}
                <Link
                    to="/"
                    data-testid="profile-pill"
                    className="lg:hidden flex items-center gap-1.5 bg-white/5 rounded-full pr-2 p-1 border border-white/10 max-w-[34%] hover:border-white/20 transition flex-shrink"
                >
                    {user?.photo_url ? (
                        <img
                            src={user.photo_url}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover ring-1 ring-white/10"
                        />
                    ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyber-purple to-cyber-cyan flex items-center justify-center text-xs font-black">
                            {(user?.first_name || user?.username || "L").slice(0, 1).toUpperCase()}
                        </div>
                    )}
                    <div className="flex flex-col leading-tight min-w-0">
                        <span data-testid="user-display-name" className="text-[11px] font-semibold text-white truncate">
                            @{user?.username || user?.first_name || "anon"}
                        </span>
                        {short ? (
                            <span data-testid="ton-address-short" className="text-[9px] text-cyber-cyan font-mono truncate">
                                {short}
                            </span>
                        ) : (
                            <span className="text-[9px] text-white/40 font-mono">{t("header.no_wallet")}</span>
                        )}
                    </div>
                </Link>

                {/* Right cluster: language + sound + balance widget.
                    Phase 11.2.6 — the standalone <TonConnectButton /> used to
                    sit to the right of the balance widget and was visually
                    competing with it (two CTAs that "look like deposit").
                    It has been removed; the balance widget is now the single
                    money entry point that opens DepositChoiceModal where
                    "Connect wallet" lives as one of two choices. */}
                <div className="flex items-center gap-1 lg:gap-2 min-w-0 lg:ml-auto">
                    <OnlineCounter />
                    <LanguageToggle className="flex-shrink-0" />
                    <SoundToggle compact className="flex-shrink-0" />
                    <button
                        data-testid="header-deposit-btn"
                        onClick={() => { tapMedium(); onOpenDeposit?.(); }}
                        aria-label={t("header.deposit_aria")}
                        className="flex items-center gap-1 bg-gradient-to-br from-cyber-cyan/10 to-cyber-purple/10 border border-cyber-cyan/30 hover:border-cyber-cyan/60 rounded-xl px-2.5 py-1.5 transition flex-shrink-0"
                    >
                        <Diamond className="w-3.5 h-3.5 text-cyber-cyan" strokeWidth={2.5} />
                        <RollingNumber
                            value={balance ?? 0}
                            format={(n) => formatTON(n)}
                            data-testid="ton-balance"
                            className="text-xs font-bold tabular-nums"
                        />
                        <span className="text-[9px] text-white/60 font-bold">TON</span>
                        <ArrowDownToLine className="w-3 h-3 text-cyber-cyan ml-0.5" />
                    </button>
                </div>
            </div>
            {/* Phase 7c — Battle Pass XP HUD below the top bar, with VIP tier badge anchored right */}
            <div className="max-w-[430px] lg:max-w-none mx-auto mt-1 lg:px-2 relative">
                <SeasonHud user={user} />
                <div className="absolute top-1 right-1 z-10">
                    <VipBadge user={user} />
                </div>
            </div>
        </header>
    );
};

export const BottomNav = ({ isAdmin = false }) => {
    const { t } = useTranslation();
    return (
        <nav
            data-testid="bottom-nav"
            className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl bg-cyber-bg/90 border-t border-white/8 lg:hidden"
            style={{
                // Phase 11.2.7-A — push bottom nav up by the Telegram chrome
                // safe-area bottom inset (home indicator on iOS, gesture bar
                // on Android, etc).  --tg-safe-bottom is set by tgReady()
                // from window.Telegram.WebApp.contentSafeAreaInset.bottom
                // and stays in sync via the contentSafeAreaChanged event.
                paddingBottom: "max(var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))",
            }}
        >
            {/* Phase 6f — exactly 6 entries in fixed order:
                  PVP / Roulette / Cases / Leaderboard / Inventory / Profile
                Withdraw is intentionally removed; users reach it via the
                Withdraw CTA at the top of /inventory. */}
            <div className="max-w-[640px] mx-auto grid grid-cols-6 gap-0 px-1 pt-1.5 pb-1.5">
                <NavTab to="/battles"     icon={Swords}   label={t("nav.pvp")}        testid="nav-pvp" />
                {/* Phase 11.5-C — Roulette removed from bottom nav per user
                    request ("колесо вместо рулетки"). The Roulette page,
                    route /roulette and WebSocket endpoint are deliberately
                    kept reachable (via deep links, Game Tiles row, history
                    entries) so the feature can be re-promoted later with a
                    one-line revert. Only the entry point in the primary
                    chrome is swapped to Wheel of Fortune. */}
                <NavTab to="/wheel"       icon={Disc3}    label={t("nav.wheel")}      testid="nav-wheel" />
                <NavTab to="/"            icon={Package}  label={t("nav.cases")}      testid="nav-cases" end />
                <NavTab to="/leaderboard" icon={Trophy}   label={t("nav.leaderboard")} testid="nav-leaderboard" />
                <NavTab to="/inventory"   icon={Backpack} label={t("nav.inventory")}  testid="nav-inventory" />
                <NavTab to="/profile"     icon={User}     label={t("nav.profile")}    testid="nav-profile" />
            </div>
        </nav>
    );
};

const NavTab = ({ to, icon: Icon, label, testid, end }) => (
    <NavLink
        to={to}
        end={end}
        data-testid={testid}
        onClick={() => { tapLight(); sfx.play("tab_tap", { volume: 0.4 }); }}
        className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 min-h-[44px] py-1 rounded-lg transition active:scale-95 ${
                isActive
                    ? "text-cyber-cyan"
                    : "text-white/45 hover:text-white/80"
            }`
        }
    >
        {({ isActive }) => (
            <>
                <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[9px] font-bold uppercase tracking-tight leading-tight truncate w-full text-center px-0.5">{label}</span>
            </>
        )}
    </NavLink>
);
