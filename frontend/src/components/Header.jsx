import React from "react";
import { Link, NavLink } from "react-router-dom";
import { TonConnectButton, useTonAddress } from "@tonconnect/ui-react";
import { Diamond, Package, Home, ArrowDownToLine, Users, Shield, ArrowUpRight, Trophy } from "lucide-react";
import { formatTON } from "@/lib/rarity";
import { SoundToggle } from "@/components/SoundToggle";

export const Header = ({ user, balance, onLogout, onOpenDeposit }) => {
    const tonAddress = useTonAddress();
    const short = tonAddress
        ? `${tonAddress.slice(0, 4)}…${tonAddress.slice(-4)}`
        : null;

    return (
        <header
            data-testid="app-header"
            className="sticky top-0 z-40 w-full backdrop-blur-xl bg-cyber-bg/75 border-b border-white/5 px-4 py-3"
        >
            <div className="max-w-[430px] mx-auto flex items-center justify-between gap-1.5">
                {/* Profile pill */}
                <Link
                    to="/"
                    data-testid="profile-pill"
                    className="flex items-center gap-1.5 bg-white/5 rounded-full pr-2.5 p-1 border border-white/10 max-w-[38%] hover:border-white/20 transition flex-shrink"
                >
                    {user?.photo_url ? (
                        <img
                            src={user.photo_url}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
                        />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyber-purple to-cyber-cyan flex items-center justify-center text-xs font-black">
                            {(user?.first_name || user?.username || "L").slice(0, 1).toUpperCase()}
                        </div>
                    )}
                    <div className="flex flex-col leading-tight min-w-0">
                        <span data-testid="user-display-name" className="text-xs font-semibold text-white truncate">
                            @{user?.username || user?.first_name || "anon"}
                        </span>
                        {short ? (
                            <span data-testid="ton-address-short" className="text-[10px] text-cyber-cyan font-mono truncate">
                                {short}
                            </span>
                        ) : (
                            <span className="text-[10px] text-white/40 font-mono">no wallet</span>
                        )}
                    </div>
                </Link>

                {/* Balance + deposit + tonconnect */}
                <div className="flex items-center gap-1.5 min-w-0">
                    <SoundToggle compact className="-mr-0.5 flex-shrink-0" />
                    <button
                        data-testid="header-deposit-btn"
                        onClick={onOpenDeposit}
                        className="flex items-center gap-1 bg-gradient-to-br from-cyber-cyan/10 to-cyber-purple/10 border border-cyber-cyan/30 hover:border-cyber-cyan/60 rounded-xl px-2 py-1.5 transition flex-shrink-0"
                    >
                        <Diamond className="w-3.5 h-3.5 text-cyber-cyan" strokeWidth={2.5} />
                        <span data-testid="ton-balance" className="text-xs font-bold tabular-nums">
                            {formatTON(balance)}
                        </span>
                        <span className="text-[9px] text-white/60 font-bold">TON</span>
                        <ArrowDownToLine className="w-3 h-3 text-cyber-cyan ml-0.5" />
                    </button>
                    <div data-testid="tonconnect-button-wrap" className="scale-75 origin-right flex-shrink-0 -mr-2">
                        <TonConnectButton />
                    </div>
                </div>
            </div>
        </header>
    );
};

export const BottomNav = ({ isAdmin = false }) => (
    <nav
        data-testid="bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl bg-cyber-bg/85 border-t border-white/8"
    >
        <div className="max-w-[430px] mx-auto flex items-stretch justify-around px-2 py-2">
            <NavTab to="/" icon={Home} label="Cases" testid="nav-cases" end />
            <NavTab to="/inventory" icon={Package} label="Collection" testid="nav-inventory" />
            <NavTab to="/leaderboard" icon={Trophy} label="Leaders" testid="nav-leaderboard" />
            <NavTab to="/withdrawals" icon={ArrowUpRight} label="Withdraw" testid="nav-withdrawals" />
            <NavTab to="/friends" icon={Users} label="Friends" testid="nav-friends" />
            {isAdmin && (
                <NavTab to="/admin" icon={Shield} label="Admin" testid="nav-admin" />
            )}
        </div>
    </nav>
);

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
                <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </>
        )}
    </NavLink>
);
