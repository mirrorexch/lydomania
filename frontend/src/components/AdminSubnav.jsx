import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Shield, Inbox, Box, Layers, SlidersHorizontal, Ticket, Activity, Users, Diamond, Settings as Cog } from "lucide-react";
import { useTranslation } from "react-i18next";

const Tab = ({ to, icon: Icon, label, testid, end }) => (
    <NavLink
        to={to}
        end={end}
        data-testid={testid}
        className={({ isActive }) =>
            `inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg border whitespace-nowrap transition ${
                isActive
                    ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan"
                    : "bg-white/5 border-white/10 text-white/55 hover:bg-white/10"
            }`
        }
    >
        <Icon className="w-3 h-3" />
        {label}
    </NavLink>
);

export const AdminLayout = ({ isAdmin = true }) => {
    const { t } = useTranslation();
    if (!isAdmin) {
        return (
            <main className="mx-auto px-4 pt-10 pb-24 max-w-md text-center" data-testid="admin-layout-forbidden">
                <Shield className="w-10 h-10 text-white/25 mx-auto mb-3" />
                <h1 className="font-display text-xl font-black tracking-tight text-white/80 mb-1">
                    {t("admin.title")}
                </h1>
                <p className="text-xs text-white/45">
                    {t("admin.not_authorised") /* "Admin access required." */}
                </p>
            </main>
        );
    }
    return (
        <main className="mx-auto px-4 sm:px-6 pt-3 pb-24 lg:pb-6
            max-w-[430px] sm:max-w-[640px] lg:max-w-[860px]" data-testid="admin-layout">
            <div className="flex items-baseline justify-between mb-2">
                <h1 className="font-display text-2xl font-black tracking-tight inline-flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyber-cyan" />
                    {t("admin.title")}
                </h1>
                <div className="text-[10px] text-white/40 uppercase tracking-[0.2em]">{t("admin.phase_chip")}</div>
            </div>
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                <Tab to="/admin" end icon={Inbox} label={t("admin.tab_queue")} testid="admin-subnav-withdrawals" />
                <Tab to="/admin/cases" icon={Box} label={t("admin.tab_cases")} testid="admin-subnav-cases" />
                <Tab to="/admin/items" icon={Layers} label={t("admin.tab_items")} testid="admin-subnav-items" />
                <Tab to="/admin/promos" icon={Ticket} label={t("admin.tab_promos")} testid="admin-subnav-promos" />
                <Tab to="/admin/digest" icon={Activity} label={t("admin.tab_digest")} testid="admin-subnav-digest" />
                <Tab to="/admin/users" icon={Users} label={t("admin.tab_users")} testid="admin-subnav-users" />
                <Tab to="/admin/sell-reviews" icon={Diamond} label={t("admin.tab_sell_reviews")} testid="admin-subnav-sell-reviews" />
                <Tab to="/admin/roulette-config" icon={Cog} label={t("admin.tab_roulette_config")} testid="admin-subnav-roulette-config" />
                <Tab to="/admin/settings" icon={SlidersHorizontal} label={t("admin.tab_settings")} testid="admin-subnav-settings" />
            </div>
            <Outlet />
        </main>
    );
};

export default AdminLayout;
