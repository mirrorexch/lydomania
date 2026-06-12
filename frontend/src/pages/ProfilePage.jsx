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
    ArrowUpRight, Users as UsersIcon,
    Shield, LogOut, ChevronRight, Diamond, Wallet,
} from "lucide-react";
import { formatTON } from "@/lib/rarity";
import { SoundToggle } from "@/components/SoundToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { RollingNumber } from "@/components/RollingNumber";


const Row = ({ to, icon: Icon, label, sub, testid }) => (
    <Link to={to} data-testid={testid} className="v-prow">
        <div className="ic"><Icon className="w-4 h-4" /></div>
        <div className="tx">
            <b className="truncate">{label}</b>
            {sub && <span className="truncate">{sub}</span>}
        </div>
        <ChevronRight className="w-4 h-4 ch" />
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
            className="v-wrap"
            style={{ minHeight: "var(--app-vh, 100dvh)" }}
        >
            {/* Identity card */}
            <section data-testid="profile-identity" className="v-idcard" style={{ marginTop: 6 }}>
                <div className="relative" style={{ width: 54, height: 54, flex: "none" }}>
                    <img
                        src="/banners/profile_avatar_ring.png"
                        alt=""
                        aria-hidden="true"
                        className="absolute top-1/2 left-1/2 w-20 h-20 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none object-contain"
                        style={{ animation: "lydoRingPulse 4s ease-in-out infinite", mixBlendMode: "screen" }}
                    />
                    {user?.photo_url ? (
                        <img src={user.photo_url} alt="" className="relative v-avatar" />
                    ) : (
                        <div className="relative v-avatar ph">
                            {(user?.first_name || user?.username || "L").slice(0, 1).toUpperCase()}
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="v-idname truncate">{user?.first_name || user?.username || "Player"}</div>
                    <div className="v-idhandle truncate">
                        {user?.username ? `@${user.username}` : `tg${user?.telegram_id || ""}`}
                    </div>
                </div>
                {isAdmin && (
                    <span data-testid="profile-admin-badge" className="v-btag gold">
                        {t("profile.admin_badge")}
                    </span>
                )}
            </section>

            {/* Balance + wallet */}
            <section className="v-balcard" style={{ marginTop: 14 }}>
                <div className="v-balrow">
                    <span className="v-ballbl">{t("profile.balance")}</span>
                    <span data-testid="profile-balance" className="v-balval">
                        <RollingNumber value={balance ?? 0} format={(n) => formatTON(n)} duration={0.7} />
                        {" "}<span style={{ fontSize: 13, color: "var(--v-muted)" }}>TON</span>
                    </span>
                </div>
                <div className="flex items-center gap-2 pt-3 mt-3" style={{ borderTop: "1px solid var(--v-line-soft)" }}>
                    <Wallet className="w-4 h-4 flex-shrink-0" style={{ color: "var(--v-gold)" }} />
                    <span className="flex-1 truncate" style={{ font: "500 11px 'Inter'", color: "var(--v-muted)" }}>
                        {short ? t("profile.wallet_connected", { addr: short }) : t("profile.wallet_disconnected")}
                    </span>
                    <TonConnectButton className="!h-8" />
                </div>
            </section>

            {/* Shortcuts */}
            <section className="space-y-2 mt-4">
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
            <section className="v-balcard mt-4 space-y-3">
                <div className="v-ballbl">{t("profile.preferences")}</div>
                <div className="flex items-center gap-3">
                    <LanguageToggle data-testid="profile-language-toggle" />
                    <SoundToggle data-testid="profile-sound-toggle" />
                </div>
                {/* Phase 6g · Step 11 — Telegram fullscreen toggle (Bot API 8.0+). */}
                <FullscreenToggle data-testid="profile-fullscreen-toggle" />
            </section>

            {/* Sign out */}
            <button onClick={() => onLogout?.()} data-testid="profile-logout-btn" className="v-logout mt-4">
                <LogOut className="w-4 h-4" /> {t("profile.logout")}
            </button>
        </main>
    );
}
