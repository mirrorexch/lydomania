/**
 * Phase 6f — ProfilePage
 *
 * Replaces the removed bottom-nav "Withdraw" entry by giving users a real
 * profile hub. Bundles:
 *   - identity (photo + name + telegram id)
 *   - balance + TON Connect status
 *   - shortcuts: withdrawal queue, friends/referrals, admin (if admin)
 *   - language / sound toggles
 *   - logout
 */
import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTonAddress, TonConnectButton } from "@tonconnect/ui-react";
import {
    User as UserIcon, ArrowUpRight, Users as UsersIcon,
    Shield, LogOut, ChevronRight, Diamond, Wallet,
} from "lucide-react";
import { formatTON } from "@/lib/rarity";
import { SoundToggle } from "@/components/SoundToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { RollingNumber } from "@/components/RollingNumber";


const Row = ({ to, icon: Icon, label, sub, testid }) => (
    <Link
        to={to}
        data-testid={testid}
        className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-cyber-surface/55 border border-white/10 hover:border-cyber-cyan/40 transition group"
    >
        <div className="p-2 rounded-lg bg-white/[0.04] border border-white/10 group-hover:border-cyber-cyan/40 transition">
            <Icon className="w-4 h-4 text-cyber-cyan" />
        </div>
        <div className="flex-1 min-w-0">
            <div className="font-display text-sm font-bold text-white truncate">{label}</div>
            {sub && <div className="text-[10px] text-white/45 truncate">{sub}</div>}
        </div>
        <ChevronRight className="w-4 h-4 text-white/35 group-hover:text-cyber-cyan group-hover:translate-x-0.5 transition" />
    </Link>
);


export default function ProfilePage({ user, balance, onLogout }) {
    const { t } = useTranslation();
    const tonAddress = useTonAddress();
    const short = tonAddress
        ? `${tonAddress.slice(0, 5)}…${tonAddress.slice(-5)}`
        : null;
    const isAdmin = !!user?.is_admin;

    return (
        <main
            data-testid="profile-page"
            className="mx-auto px-3 sm:px-6 pt-4 pb-32 lg:pb-6 space-y-5
                       max-w-[430px] sm:max-w-[560px] lg:max-w-[640px]"
        >
            {/* Identity card */}
            <section
                data-testid="profile-identity"
                className="rounded-2xl bg-gradient-to-br from-cyber-purple/15 via-cyber-surface/60 to-cyber-cyan/10 border border-white/10 p-4 flex items-center gap-3"
            >
                {/* Phase 6h — Avatar ring: cyan→purple glow PNG sits behind the
                    avatar (w-14 × 1.45 ≈ w-20). Subtle 4s pulse for life.
                    Phase 6i: ring asset is opaque dark-bg so we use
                    mix-blend-mode: screen — dark pixels become transparent and
                    only the bright ring contributes additively. No black square. */}
                <div className="relative w-14 h-14 flex-shrink-0">
                    <img
                        src="/banners/profile_avatar_ring.png"
                        alt=""
                        aria-hidden="true"
                        className="absolute top-1/2 left-1/2 w-20 h-20 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none object-contain"
                        style={{
                            animation: "lydoRingPulse 4s ease-in-out infinite",
                            mixBlendMode: "screen",
                        }}
                    />
                    {user?.photo_url ? (
                        <img
                            src={user.photo_url}
                            alt=""
                            className="relative w-14 h-14 rounded-full object-cover ring-2 ring-cyber-cyan/40"
                        />
                    ) : (
                        <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-cyber-purple to-cyber-cyan flex items-center justify-center font-display text-xl font-black">
                            {(user?.first_name || user?.username || "L").slice(0, 1).toUpperCase()}
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="font-display text-lg font-black truncate">
                        {user?.first_name || user?.username || "Player"}
                    </div>
                    <div className="text-[11px] text-white/55 font-mono truncate">
                        {user?.username ? `@${user.username}` : `tg${user?.telegram_id || ""}`}
                    </div>
                </div>
                {isAdmin && (
                    <span
                        data-testid="profile-admin-badge"
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-gold-bright/15 text-gold-bright border border-gold-bright/40"
                    >
                        {t("profile.admin_badge")}
                    </span>
                )}
            </section>

            {/* Balance + wallet */}
            <section className="rounded-2xl bg-cyber-surface/55 border border-white/10 p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
                        {t("profile.balance")}
                    </span>
                    <span
                        data-testid="profile-balance"
                        className="font-display text-2xl font-black tabular-nums text-cyber-cyan"
                    >
                        <RollingNumber
                            value={balance ?? 0}
                            format={(n) => formatTON(n)}
                            duration={0.7}
                        />
                        {" "}<span className="text-xs text-white/55">TON</span>
                    </span>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-white/8">
                    <Wallet className="w-4 h-4 text-cyber-purple flex-shrink-0" />
                    <span className="text-[11px] text-white/55 flex-1 truncate">
                        {short ? t("profile.wallet_connected", { addr: short }) : t("profile.wallet_disconnected")}
                    </span>
                    <TonConnectButton className="!h-8" />
                </div>
            </section>

            {/* Shortcuts */}
            <section className="space-y-2">
                <Row
                    to="/withdrawals"
                    icon={ArrowUpRight}
                    label={t("profile.row_withdrawals")}
                    sub={t("profile.row_withdrawals_sub")}
                    testid="profile-row-withdrawals"
                />
                <Row
                    to="/inventory"
                    icon={Diamond}
                    label={t("profile.row_inventory")}
                    sub={t("profile.row_inventory_sub")}
                    testid="profile-row-inventory"
                />
                <Row
                    to="/friends"
                    icon={UsersIcon}
                    label={t("profile.row_friends")}
                    sub={t("profile.row_friends_sub")}
                    testid="profile-row-friends"
                />
                {isAdmin && (
                    <Row
                        to="/admin"
                        icon={Shield}
                        label={t("profile.row_admin")}
                        sub={t("profile.row_admin_sub")}
                        testid="profile-row-admin"
                    />
                )}
            </section>

            {/* Preferences */}
            <section className="rounded-2xl bg-cyber-surface/55 border border-white/10 p-4 space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
                    {t("profile.preferences")}
                </div>
                <div className="flex items-center gap-3">
                    <LanguageToggle data-testid="profile-language-toggle" />
                    <SoundToggle data-testid="profile-sound-toggle" />
                </div>
                {/* Phase 6g · Step 11 — Telegram fullscreen toggle (Bot API 8.0+).
                    Default ON, persisted in localStorage["lydomania:fullscreen"]. */}
                <FullscreenToggle data-testid="profile-fullscreen-toggle" />
            </section>

            {/* Sign out */}
            <button
                onClick={() => onLogout?.()}
                data-testid="profile-logout-btn"
                className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15 transition px-4 py-3 inline-flex items-center justify-center gap-2 text-rose-200 font-bold text-sm tracking-wider uppercase"
            >
                <LogOut className="w-4 h-4" /> {t("profile.logout")}
            </button>
        </main>
    );
}
