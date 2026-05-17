/**
 * Phase 6a — Responsive AppShell.
 *
 * Wraps the routed content and decides which navigation surface is visible
 * based on viewport. Below `lg` (1024px) the layout matches the original
 * mobile experience (sticky Header + BottomNav). At `lg+` a left SideNav
 * appears (240px) and content shifts right with `lg:pl-60`. The mobile
 * Header keeps rendering on every breakpoint — it owns the balance pill,
 * deposit button and TonConnect button, which are essential controls. At
 * lg+ it lives inside the offset wrapper so the SideNav doesn't overlap.
 * At `xl+` the right LiveActivityRail (300px) becomes visible.
 *
 * Layout summary:
 *   mobile  (<lg) : Header (sticky top) + main + BottomNav (sticky bottom)
 *   lg+           : SideNav (left) + [Header sticky top within offset] + main
 *   xl+           : SideNav + [Header + main] (pl-60 pr-[300px]) + ActivityRail
 */
import React from "react";
import { SideNav } from "@/components/SideNav";
import { LiveActivityRail } from "@/components/LiveActivityRail";

export const AppShell = ({ user, children, mobileHeader, mobileNav }) => {
    const isAdmin = !!user?.is_admin;
    return (
        <>
            <SideNav isAdmin={isAdmin} />

            <div className="lg:pl-60 xl:pr-[300px] min-h-screen">
                {mobileHeader}
                {children}
            </div>

            {/* Mobile/tablet bottom nav — hidden at lg+ */}
            <div className="lg:hidden">
                {mobileNav}
            </div>

            <LiveActivityRail />
        </>
    );
};

export default AppShell;
