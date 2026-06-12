import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { http, fetchCases, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";
import { openDeposit } from "@/lib/deposit";

const GAMES = [
    { to: "/crash", ic: "🚀", k: "vhome.g_crash" },
    { to: "/mines", ic: "💣", k: "vhome.g_mines" },
    { to: "/wheel", ic: "🎡", k: "vhome.g_wheel" },
    { to: "/battles", ic: "⚔️", k: "nav.battles" },
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
    const { t } = useTranslation();
    const img = resolveImage(c.image_url || c.banner_url || c.image);
    const rarity = caseRarity(c.price_ton);
    return (
        <div className="v-case" data-rarity={rarity} onClick={() => onOpen(c)}>
            <div className="v-top">
                <span className="v-rar"><i className="v-jewel" />{t(`rarity.${rarity}`, { defaultValue: rarity })}</span>
                <div className="v-gift">{img ? <img src={img} alt={c.name} /> : "🎁"}</div>
            </div>
            <div className="v-meta">
                <h3 className="v-disp" title={c.name}>{c.name}</h3>
                <div className="v-price">
                    <span className="p v-mono"><span className="coin" />{formatTON(c.price_ton)}</span>
                    <span className="open">{t("vhome.open_short")}</span>
                </div>
            </div>
        </div>
    );
}

export const VaultHome = ({ balance = 0 }) => {
    const { t } = useTranslation();
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
                    {t("vhome.live_jackpot")}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0 14px" }}>
                    <b className="v-mono" style={{ font: "600 34px 'JetBrains Mono'", color: "var(--v-gold-hi)", letterSpacing: "-.02em", textShadow: "0 0 22px rgba(232,184,75,.35)" }}>
                        {jackpot != null ? formatTON(jackpot) : "—"}
                    </b>
                    <small style={{ font: "600 10px 'Inter'", letterSpacing: ".2em", textTransform: "uppercase", color: "var(--v-muted)" }}>{t("vhome.in_vault")}</small>
                </div>
                <h1 className="v-disp">{t("vhome.open_the")} <span className="v-gold-text">{t("vhome.vault_word")}</span>.</h1>
                <p>{t("vhome.subtitle")}</p>
                <button className="v-cta" onClick={() => featured[0] ? nav(`/case/${featured[0].id}`) : nav("/")}>{t("vhome.open_a_case")}</button>
            </section>

            <section className="v-sec">
                <div className="v-games">
                    {GAMES.map((g) => (
                        <div key={g.to} className="v-game" onClick={() => nav(g.to)}>
                            <div className="ic">{g.ic}</div><span>{t(g.k)}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="v-sec">
                <div className="v-sechead"><h2 className="v-disp">{t("vhome.featured")}</h2><a onClick={() => nav("/cases")}>{t("vhome.all")}</a></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {featured.map((c) => <CaseTile key={c.id} c={c} onOpen={(x) => nav(`/case/${x.id}`)} />)}
                    {featured.length === 0 && <div className="v-muted" style={{ gridColumn: "1/-1", textAlign: "center", padding: "24px 0", fontSize: 12 }}>{t("vhome.loading_cases")}</div>}
                </div>
            </section>
        </main>
    );
};

export default VaultHome;
