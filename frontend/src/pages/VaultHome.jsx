import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http, fetchCases, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { openDeposit } from "@/lib/deposit";

const GAMES = [
    { to: "/crash", ic: "🚀", label: "Crash" },
    { to: "/mines", ic: "💣", label: "Mines" },
    { to: "/wheel", ic: "🎡", label: "Wheel" },
    { to: "/battles", ic: "⚔️", label: "Battles" },
];

// Map a case price to a rarity tier for the jewel tint (cheap→legendary).
function caseRarity(price) {
    const p = Number(price) || 0;
    if (p >= 250) return "mythic";
    if (p >= 50) return "legendary";
    if (p >= 15) return "epic";
    return "uncommon";
}

function CaseTile({ c, onOpen }) {
    const img = resolveImage(c.image_url || c.banner_url || c.image);
    return (
        <div className="v-case" data-rarity={caseRarity(c.price_ton)} onClick={() => onOpen(c)}>
            <div className="v-top">
                <span className="v-rar"><i className="v-jewel" />{caseRarity(c.price_ton)}</span>
                <div className="v-gift">{img ? <img src={img} alt={c.name} /> : "🎁"}</div>
            </div>
            <div className="v-meta">
                <h3 className="v-disp" title={c.name}>{c.name}</h3>
                <div className="v-price">
                    <span className="p v-mono"><span className="coin" />{formatTON(c.price_ton)}</span>
                    <span className="open">Open</span>
                </div>
            </div>
        </div>
    );
}

export const VaultHome = ({ balance = 0 }) => {
    const nav = useNavigate();
    const [cases, setCases] = useState([]);
    const [jackpot, setJackpot] = useState(null);

    useEffect(() => {
        fetchCases().then((rows) => setCases((rows || []).filter((c) => Number(c.price_ton) > 0))).catch(() => {});
        http.get("/activity/jackpot-24h").then(({ data }) => setJackpot(data?.total_ton ?? data?.jackpot_ton ?? null)).catch(() => {});
    }, []);

    const featured = cases.slice(0, 6);

    return (
        <main className="v-wrap">
            <section className="v-hero">
                <span className="v-ring" />
                <div className="v-eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <i style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--v-emerald)", boxShadow: "0 0 8px var(--v-emerald)" }} />
                    Live Jackpot · TON Mainnet
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0 14px" }}>
                    <b className="v-mono" style={{ font: "600 34px 'JetBrains Mono'", color: "var(--v-gold-hi)", letterSpacing: "-.02em", textShadow: "0 0 22px rgba(232,184,75,.35)" }}>
                        {jackpot != null ? formatTON(jackpot) : "—"}
                    </b>
                    <small style={{ font: "600 10px 'Inter'", letterSpacing: ".2em", textTransform: "uppercase", color: "var(--v-muted)" }}>TON in the vault</small>
                </div>
                <h1 className="v-disp">Open the <span className="v-gold-text">vault</span>.</h1>
                <p>Provably-fair cases paid in real Telegram gift NFTs. Withdraw any time.</p>
                <button className="v-cta" onClick={() => featured[0] ? nav(`/case/${featured[0].id}`) : nav("/")}>Open a case →</button>
            </section>

            <section className="v-sec">
                <div className="v-games">
                    {GAMES.map((g) => (
                        <div key={g.to} className="v-game" onClick={() => nav(g.to)}>
                            <div className="ic">{g.ic}</div><span>{g.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="v-sec">
                <div className="v-sechead"><h2 className="v-disp">Featured cases</h2><a onClick={() => nav("/cases")}>All →</a></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {featured.map((c) => <CaseTile key={c.id} c={c} onOpen={(x) => nav(`/case/${x.id}`)} />)}
                    {featured.length === 0 && <div className="v-muted" style={{ gridColumn: "1/-1", textAlign: "center", padding: "24px 0", fontSize: 12 }}>Loading cases…</div>}
                </div>
            </section>
        </main>
    );
};

export default VaultHome;
