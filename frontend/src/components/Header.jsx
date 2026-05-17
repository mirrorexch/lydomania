import React from "react";
import { Link, NavLink } from "react-router-dom";
import { TonConnectButton, useTonAddress } from "@tonconnect/ui-react";
import { Diamond, Package, Home, ArrowDownToLine, Users, Shield, ArrowUpRight, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTON } from "@/lib/rarity";
import { SoundToggle } from "@/components/SoundToggle";
import { LanguageToggle } from "@/components/LanguageToggle";

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

                {/* Right cluster: language + sound + balance + tonconnect */}
                <div className="flex items-center gap-1 lg:gap-2 min-w-0 lg:ml-auto">
                    <LanguageToggle className="flex-shrink-0" />
                    <SoundToggle compact className="flex-shrink-0" />
                    <button
                        data-testid="header-deposit-btn"
                        onClick={onOpenDeposit}
                        aria-label={t("header.deposit_aria")}
                        className="flex items-center gap-1 bg-gradient-to-br from-cyber-cyan/10 to-cyber-purple/10 border border-cyber-cyan/30 hover:border-cyber-cyan/60 rounded-xl px-2 py-1.5 transition flex-shrink-0"
                    >
                        <Diamond className="w-3.5 h-3.5 text-cyber-cyan" strokeWidth={2.5} />
                        <span data-testid="ton-balance" className="text-xs font-bold tabular-nums">
                            {formatTON(balance)}
                        </span>
                        <span className="text-[9px] text-white/60 font-bold">TON</span>
                        <ArrowDownToLine className="w-3 h-3 text-cyber-cyan ml-0.5" />
                    </button>
                    <div data-testid="tonconnect-button-wrap" className="scale-[0.7] origin-right flex-shrink-0 -mr-2">
                        <TonConnectButton />
                    </div>
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
            className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl bg-cyber-bg/85 border-t border-white/8"
        >
            <div className="max-w-[430px] mx-auto flex items-stretch justify-around px-2 py-2">
                <NavTab to="/" icon={Home} label={t("nav.cases")} testid="nav-cases" end />
                <NavTab to="/inventory" icon={Package} label={t("nav.collection")} testid="nav-inventory" />
                <NavTab to="/leaderboard" icon={Trophy} label={t("nav.leaders")} testid="nav-leaderboard" />
                <NavTab to="/withdrawals" icon={ArrowUpRight} label={t("nav.withdraw")} testid="nav-withdrawals" />
                <NavTab to="/friends" icon={Users} label={t("nav.friends")} testid="nav-friends" />
                {isAdmin && (
                    <NavTab to="/admin" icon={Shield} label={t("nav.admin")} testid="nav-admin" />
                )}
            </div>
        </nav>
    );
};

const NavTab = ({ to, icon: Icon, label, testid, end }) => (
    <NavLink
        to={to}
        end={end}
        data-testid={testid}
        className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 flex-1 py-1.5 rounded-lg transition ${
                isActive
                    ? "text-cyber-cyan"
                    : "text-white/45 hover:text-white/80"
            }`
        }
    >
        {({ isActive }) => (
            <>
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[9px] font-bold uppercase tracking-wider truncate max-w-[60px]">{label}</span>
            </>
        )}
    </NavLink>
);
