import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
    { to: "/", gi: "◈", label: "Vault", match: (p) => p === "/" || p.startsWith("/case") },
    { to: "/crash", gi: "🚀", label: "Games", match: (p) => ["/crash", "/mines", "/wheel", "/battles", "/battle"].some((g) => p.startsWith(g)) },
    { to: "/inventory", gi: "🎁", label: "Gifts", match: (p) => p.startsWith("/inventory") },
    { to: "/withdrawals", gi: "◷", label: "History", match: (p) => p.startsWith("/withdrawals") },
    { to: "/profile", gi: "☰", label: "More", match: (p) => p.startsWith("/profile") },
];

export const VaultNav = () => {
    const nav = useNavigate();
    const { pathname } = useLocation();
    return (
        <nav className="v-nav">
            {NAV.map((n) => (
                <a key={n.label} className={n.match(pathname) ? "on" : ""} onClick={() => nav(n.to)}>
                    <span className="gi">{n.gi}</span>{n.label}
                </a>
            ))}
        </nav>
    );
};
