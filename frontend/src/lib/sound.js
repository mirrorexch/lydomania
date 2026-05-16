/**
 * Phase 4a — Sound system.
 *
 * Plays the CC0 procedurally-generated SFX pack in `/sfx/*.wav`.
 * State (mute + volume) persisted to localStorage, mirrored to a tiny
 * event-emitter so any component can subscribe and re-render.
 *
 * Usage:
 *   import { sfx, audioPrefs, useAudioPrefs } from "@/lib/sound";
 *   sfx.play("scroll_tick");
 *   sfx.playWin("legendary");          // chooses correct chime + adds confetti for legendary/mythic
 *   const [prefs, setPrefs] = useAudioPrefs();
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "lydo_audio";
const DEFAULTS = { muted: false, volume: 0.5 };

const RARITY_TO_SFX = {
    common: "win_common",
    rare: "win_rare",
    epic: "win_epic",
    legendary: "win_legendary",
    mythic: "win_mythic",
    jackpot: "win_mythic",
};

const ALL_SFX = [
    "scroll_tick", "coin_drop",
    "win_common", "win_rare", "win_epic", "win_legendary", "win_mythic",
    "confetti_burst",
];

function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        const p = JSON.parse(raw);
        return {
            muted: typeof p.muted === "boolean" ? p.muted : DEFAULTS.muted,
            volume: typeof p.volume === "number" ? Math.max(0, Math.min(1, p.volume)) : DEFAULTS.volume,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

function savePrefs(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
}

// ---- Audio pool (one HTMLAudioElement per SFX, primed on first use) ----
const POOL = {};

function getEl(name) {
    if (POOL[name]) return POOL[name];
    const el = new Audio(`/sfx/${name}.wav`);
    el.preload = "auto";
    POOL[name] = el;
    return el;
}

// ---- Pub/sub for React subscribers ----
let _state = loadPrefs();
const listeners = new Set();

function emit() {
    for (const l of listeners) {
        try { l(_state); } catch {}
    }
}

export const audioPrefs = {
    get: () => ({ ..._state }),
    set: (patch) => {
        _state = { ..._state, ...patch };
        // clamp
        _state.volume = Math.max(0, Math.min(1, _state.volume));
        savePrefs(_state);
        emit();
    },
    toggleMute: () => {
        _state = { ..._state, muted: !_state.muted };
        savePrefs(_state);
        emit();
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};

export const sfx = {
    play: (name, opts = {}) => {
        if (_state.muted) return;
        if (!ALL_SFX.includes(name)) return;
        try {
            const el = getEl(name);
            // Clone the underlying buffer so rapid repeats overlap (e.g. scroll ticks)
            const node = el.cloneNode(true);
            node.volume = Math.max(0, Math.min(1, _state.volume * (opts.volume ?? 1)));
            const p = node.play();
            if (p && typeof p.then === "function") p.catch(() => {});
        } catch {}
    },
    playWin: (rarity = "common", { confetti = null } = {}) => {
        const key = RARITY_TO_SFX[rarity] || "win_common";
        sfx.play(key);
        const showConfetti = confetti ?? (rarity === "legendary" || rarity === "mythic" || rarity === "jackpot");
        if (showConfetti) {
            // Slight delay so the chime opens, then the burst overlays
            setTimeout(() => sfx.play("confetti_burst", { volume: 0.7 }), 120);
        }
    },
    preload: () => {
        for (const name of ALL_SFX) getEl(name);
    },
};

export function useAudioPrefs() {
    const [s, setS] = useState(audioPrefs.get);
    useEffect(() => audioPrefs.subscribe(setS), []);
    return [s, audioPrefs.set, audioPrefs.toggleMute];
}
