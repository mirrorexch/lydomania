import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatTON } from "@/lib/rarity";
import { openDeposit } from "@/lib/deposit";

export const VaultHeader = ({ balance = 0 }) => {
    const nav = useNavigate();
    return (
        <header className="v-header">
            <div className="v-brand" onClick={() => nav("/")} style={{ cursor: "pointer" }}>
                <div className="v-sigil"><span>L</span></div>
                <div className="v-disp" style={{ font: "600 16px 'Space Grotesk'", letterSpacing: ".01em" }}>Lydomania</div>
            </div>
            <div className="v-balpill">
                <span className="coin" />
                <b className="v-mono">{formatTON(balance)}</b>
                <button className="plus" aria-label="Deposit" onClick={openDeposit}>+</button>
            </div>
        </header>
    );
};

const NAV = [
    { to: "/", gi: "◈", key: "vnav.games", match: (p) => p === "/" || p.startsWith("/case") },
    { to: "/crash", gi: "🚀", key: "vnav.rocket", match: (p) => ["/crash", "/mines", "/wheel", "/battles", "/battle"].some((g) => p.startsWith(g)) },
    { to: "/inventory", gi: "🎁", key: "vnav.gifts", match: (p) => p.startsWith("/inventory") },
    { to: "/battlepass", gi: "🏆", key: "vnav.pass", match: (p) => ["/battlepass", "/leaderboard", "/season"].some((g) => p.startsWith(g)) },
    { to: "/profile", gi: "☰", key: "vnav.more", match: (p) => p.startsWith("/profile") },
];

export const VaultNav = () => {
    const nav = useNavigate();
    const { t } = useTranslation();
    const { pathname } = useLocation();
    return (
        <nav className="v-nav">
            {NAV.map((n) => (
                <a key={n.key} className={n.match(pathname) ? "on" : ""} onClick={() => nav(n.to)}>
                    <span className="gi">{n.gi}</span>{t(n.key)}
                </a>
            ))}
        </nav>
    );
};
