import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Shield, Inbox, Box, Layers, SlidersHorizontal, Ticket, Activity } from "lucide-react";

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

export const AdminLayout = () => (
    <main className="max-w-[430px] mx-auto px-4 pt-3 pb-24" data-testid="admin-layout">
        <div className="flex items-baseline justify-between mb-2">
            <h1 className="font-display text-2xl font-black tracking-tight inline-flex items-center gap-2">
                <Shield className="w-5 h-5 text-cyber-cyan" />
                Admin
            </h1>
            <div className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Phase 4b</div>
        </div>
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            <Tab to="/admin" end icon={Inbox} label="Queue" testid="admin-subnav-withdrawals" />
            <Tab to="/admin/cases" icon={Box} label="Cases" testid="admin-subnav-cases" />
            <Tab to="/admin/items" icon={Layers} label="Items" testid="admin-subnav-items" />
            <Tab to="/admin/promos" icon={Ticket} label="Promos" testid="admin-subnav-promos" />
            <Tab to="/admin/digest" icon={Activity} label="Digest" testid="admin-subnav-digest" />
            <Tab to="/admin/settings" icon={SlidersHorizontal} label="Settings" testid="admin-subnav-settings" />
        </div>
        <Outlet />
    </main>
);

export default AdminLayout;
