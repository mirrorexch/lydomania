import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCases, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";

// Map a case price to a rarity tier for the jewel tint (cheap→legendary).
function caseRarity(price) {
    const p = Number(price) || 0;
    if (p >= 250) return "jackpot";
    if (p >= 100) return "mythic";
    if (p >= 50) return "legendary";
    if (p >= 15) return "epic";
    if (p >= 5) return "rare";
    return "common";
}

function CaseTile({ c, onOpen }) {
    const img = resolveImage(c.image_url || c.banner_url || c.image);
    const rarity = caseRarity(c.price_ton);
    return (
        <div className="v-case" data-rarity={rarity} onClick={() => onOpen(c)}>
            <div className="v-top">
                <span className="v-rar"><i className="v-jewel" />{rarity}</span>
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

export const VaultCasesList = () => {
    const nav = useNavigate();
    const [cases, setCases] = useState(null);

    useEffect(() => {
        fetchCases()
            .then((rows) => setCases((rows || []).filter((c) => Number(c.price_ton) > 0)
                .sort((a, b) => a.price_ton - b.price_ton)))
            .catch(() => setCases([]));
    }, []);

    return (
        <main className="v-wrap">
            <button className="v-back" onClick={() => nav("/")}><span className="a">←</span> Vault</button>
            <div className="v-sechead" style={{ marginTop: 10 }}>
                <h2 className="v-disp">All cases</h2>
                {cases && <span className="v-muted" style={{ font: "600 11px 'Inter'" }}>{cases.length} cases</span>}
            </div>
            <div className="v-grid2">
                {cases?.map((c) => <CaseTile key={c.id} c={c} onOpen={(x) => nav(`/case/${x.id}`)} />)}
                {cases === null && <div className="v-empty">Loading cases…</div>}
                {cases?.length === 0 && <div className="v-empty">No cases available right now.</div>}
            </div>
        </main>
    );
};

export default VaultCasesList;
