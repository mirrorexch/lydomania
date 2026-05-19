/**
 * Phase 6a — Desktop sidebar nav.
 *
 * Rendered ONLY at lg+ (Tailwind ≥ 1024px) inside AppShell. Hidden below.
 * On mobile/tablet, BottomNav is shown instead.
 *
 *   ┌────────────────┐
 *   │  Lydomania     │  (brand)
 *   │                │
 *   │  ● Cases       │
 *   │  ○ Collection  │
 *   │  ○ Leaders     │
 *   │  ○ Withdraw    │
 *   │  ○ Friends     │
 *   │  ○ Admin       │
 *   │                │
 *   │  (controls at  │
 *   │   bottom: lang │
 *   │   sound, ver)  │
 *   └────────────────┘
 */
import React from "react";
import { NavLink } from "react-router-dom";
import {
    Swords, Disc3, Package, Trophy, Backpack, User, Shield,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { SoundToggle } from "@/components/SoundToggle";
import { LanguageToggle } from "@/components/LanguageToggle";

const Item = ({ to, end, icon: Icon, label, testid }) => (
    <NavLink
        to={to}
        end={end}
        data-testid={testid}
        className={({ isActive }) =>
            `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-bold uppercase tracking-[0.12em] transition ${
                isActive
                    ? "bg-cyber-cyan/12 text-cyber-cyan border border-cyber-cyan/30"
                    : "text-white/55 hover:text-white hover:bg-white/5 border border-transparent"
            }`
        }
    >
        {({ isActive }) => (
            <>
                <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className="truncate">{label}</span>
                {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-cyber-cyan shadow-[0_0_8px_rgba(255,215,0,0.7)]" />}
            </>
        )}
    </NavLink>
);

export const SideNav = ({ isAdmin = false }) => {
    const { t } = useTranslation();
    return (
        <aside
            data-testid="side-nav"
            className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-60 z-30
                       bg-cyber-bg/90 backdrop-blur-xl border-r border-white/8 px-4 py-5"
        >
            {/* Brand */}
            <div className="px-2 mb-6">
                <div className="font-display text-2xl font-black tracking-tighter">
                    <span className="bg-gradient-to-r from-cyber-cyan via-cyber-purple to-cyber-magenta bg-clip-text text-transparent">
                        Lydomania
                    </span>
                </div>
                <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/35 mt-0.5">
                    TON Casino
                </div>
            </div>

            {/* Phase 6f — exact same 6 entries as the mobile BottomNav,
                in the same order. Admin entry is bonus and only visible
                if the user has admin rights. */}
            <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
                <Item to="/battles"     icon={Swords}   label={t("nav.pvp")}        testid="side-nav-pvp" />
                <Item to="/roulette"    icon={Disc3}    label={t("nav.roulette")}   testid="side-nav-roulette" />
                <Item to="/" end        icon={Package}  label={t("nav.cases")}      testid="side-nav-cases" />
                <Item to="/leaderboard" icon={Trophy}   label={t("nav.leaderboard")} testid="side-nav-leaderboard" />
                <Item to="/inventory"   icon={Backpack} label={t("nav.inventory")}  testid="side-nav-inventory" />
                <Item to="/profile"     icon={User}     label={t("nav.profile")}    testid="side-nav-profile" />
                {isAdmin && (
                    <Item to="/admin" icon={Shield} label={t("nav.admin")} testid="side-nav-admin" />
                )}
            </nav>

            <div className="pt-4 border-t border-white/8 flex items-center gap-2">
                <LanguageToggle className="flex-shrink-0" />
                <SoundToggle compact className="flex-shrink-0" />
                <div className="text-[9px] uppercase tracking-[0.18em] font-bold text-white/30 ml-auto">
                    Phase 6f
                </div>
            </div>
        </aside>
    );
};

export default SideNav;
