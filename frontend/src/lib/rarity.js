/**
 * Rarity → visual styling helpers. Keep these centralized.
 */

export const RARITY_ORDER = ["common", "rare", "epic", "legendary", "mythic", "jackpot"];

export const RARITY_LABEL = {
    common: "Common",
    rare: "Rare",
    epic: "Epic",
    legendary: "Legendary",
    mythic: "Mythic",
    jackpot: "Jackpot",
};

// hex colors (no Tailwind interpolation issues with arbitrary classes)
export const RARITY_HEX = {
    common: "#94a3b8",       // slate-400
    rare: "#00F0FF",         // cyber cyan
    epic: "#8A2BE2",         // cyber purple
    legendary: "#FFB800",    // warm gold
    mythic: "#FF003C",       // cyber magenta
    jackpot: "#FF00E5",      // hot magenta-pink (rainbow handled via gradient elsewhere)
};

export const RARITY_GLOW = {
    common: "0 0 8px rgba(148,163,184,0.35)",
    rare: "0 0 18px rgba(0,240,255,0.55)",
    epic: "0 0 22px rgba(138,43,226,0.65)",
    legendary: "0 0 28px rgba(255,184,0,0.7)",
    mythic: "0 0 32px rgba(255,0,60,0.7)",
    jackpot: "0 0 40px rgba(255,0,229,0.8)",
};

export function rarityRank(r) {
    const i = RARITY_ORDER.indexOf(r);
    return i < 0 ? 0 : i;
}

export function formatTON(n, max = 2) {
    const num = Number(n || 0);
    if (Math.abs(num) >= 1000) {
        return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
    }
    return num.toFixed(max);
}
