/**
 * Phase 4a (+6a extensions, +11.5-A perf overhaul) — Sound system.
 *
 * Plays the CC0 procedurally-generated SFX pack in `/sfx/*.wav` plus
 * the Mixkit royalty-free pack in `/sfx/*.mp3`. State (mute + volume)
 * persisted to localStorage, mirrored to a tiny event-emitter so any
 * component can subscribe and re-render.
 *
 * Phase 11.5-A perf changes (mobile/Telegram WebView lag fix):
 *   1. Eager preload of every SFX is scheduled on first user interaction
 *      (or on idle, whichever comes first) — previously the very FIRST
 *      sfx.play("X") fetched + decoded /sfx/X.wav over the network,
 *      adding 200-600 ms of jank on the click that triggered it. The
 *      preloader uses `audio.load()` (not just `new Audio()`) which
 *      actually warms the disk cache.
 *   2. Reusable Audio POOL (3 elements per SFX) instead of cloneNode()
 *      on every play() — previously each click created a fresh
 *      HTMLMediaElement that lived until GC, mounting steady memory
 *      pressure (success_bell: 17 call-sites, chip_click: 5 in Plinko).
 *      Round-robin index picks the next channel; up to 3 instances of
 *      the SAME sound can overlap (e.g. "scroll_tick" while flipping a
 *      list), beyond that we recycle the oldest channel which is the
 *      best behaviour for click-spam anyway.
 *   3. 50 ms throttle per SFX name — identical sound can't fire more
 *      than 20 times per second. Stops 5-rapid-clicks-of-the-same-button
 *      from emitting 5 overlapping audio streams that all clip and lag.
 *
 * Usage:
 *   import { sfx, audioPrefs, useAudioPrefs } from "@/lib/sound";
 *   sfx.play("scroll_tick");
 *   sfx.playWin("legendary");            // chooses correct chime + adds burst for legendary+
 *   sfx.playBatchWin("epic", true);      // 6a — used by ×10 settle (rarity chime + jackpot burst)
 *   sfx.play("promo_redeem");            // 6a — promo success ping
 *   sfx.play("free_case_ready");         // 6a — daily cooldown unlocked
 *   const [prefs, setPrefs] = useAudioPrefs();
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "lydo_audio";
const DEFAULTS = { muted: false, volume: 0.7 };

// Phase 11.5-A — perf knobs.
const POOL_SIZE_PER_SFX = 3;     // up to 3 overlapping instances per sound
const THROTTLE_MS = 50;          // same-name play() spam guard
const PRELOAD_IDLE_TIMEOUT = 1500;

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
    // Phase 6a additions
    "promo_redeem", "battle_start", "free_case_ready",
    // Phase 6i additions — Mixkit (Mixkit License, royalty-free, no attribution)
    "chip_click", "loss_thud", "case_lock_thunk", "drum_roll_buildup",
    "modal_whoosh", "tab_tap", "success_bell",
    // Phase 7a — Crash
    "rising_hum", "explosion_thud",
];

// Phase 6i — extension map. Older SFX are wav (procedurally generated);
// the 6i pack is mp3 from Mixkit. Default = wav for backwards compatibility.
const SFX_EXT = {
    chip_click: "mp3",
    loss_thud: "mp3",
    case_lock_thunk: "mp3",
    drum_roll_buildup: "mp3",
    modal_whoosh: "mp3",
    tab_tap: "mp3",
    success_bell: "mp3",
};

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

// ---- Audio pool (POOL_SIZE_PER_SFX HTMLAudioElements per SFX, round-robin) ----
const POOL = {};                       // name -> Audio[]
const POOL_CURSOR = {};                // name -> next-index for round-robin
const LAST_PLAY_AT = {};               // name -> ms timestamp of last play()

function buildPool(name) {
    const ext = SFX_EXT[name] || "wav";
    const src = `/sfx/${name}.${ext}`;
    const arr = new Array(POOL_SIZE_PER_SFX);
    for (let i = 0; i < POOL_SIZE_PER_SFX; i++) {
        const el = new Audio(src);
        el.preload = "auto";
        // Telegram WebView ignores `preload` on first instance sometimes —
        // force the load() call so the request is actually scheduled.
        try { el.load(); } catch {}
        arr[i] = el;
    }
    POOL[name] = arr;
    POOL_CURSOR[name] = 0;
    return arr;
}

function nextEl(name) {
    const pool = POOL[name] || buildPool(name);
    const i = POOL_CURSOR[name] % POOL_SIZE_PER_SFX;
    POOL_CURSOR[name] = (i + 1) % POOL_SIZE_PER_SFX;
    return pool[i];
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
        // Phase 11.5-A — 50 ms throttle per SFX name. Spam-click protection.
        const now = performance.now ? performance.now() : Date.now();
        const last = LAST_PLAY_AT[name] || 0;
        if (now - last < THROTTLE_MS) return;
        LAST_PLAY_AT[name] = now;
        try {
            const el = nextEl(name);
            // Rewind in case the previous play on this channel hasn't finished.
            try { el.currentTime = 0; } catch {}
            el.volume = Math.max(0, Math.min(1, _state.volume * (opts.volume ?? 1)));
            const p = el.play();
            if (p && typeof p.then === "function") p.catch(() => {});
        } catch {}
    },
    playWin: (rarity = "common", { confetti = null } = {}) => {
        const key = RARITY_TO_SFX[rarity] || "win_common";
        sfx.play(key);
        const showConfetti = confetti ?? (rarity === "legendary" || rarity === "mythic" || rarity === "jackpot");
        if (showConfetti) {
            setTimeout(() => sfx.play("confetti_burst", { volume: 0.7 }), 120);
        }
    },
    /**
     * Phase 6a — ×10 batch settle sound.
     * Fires a single rarity chime for the highest rarity in the batch, plus a
     * confetti burst if any roll is jackpot (≥5× the case price).
     * Call ONCE after BatchOpenAnimation completes — not per-roll.
     */
    playBatchWin: (highestRarity = "common", hasJackpot = false) => {
        sfx.playWin(highestRarity, { confetti: hasJackpot });
        if (hasJackpot) {
            setTimeout(() => sfx.play("coin_drop", { volume: 0.6 }), 350);
        }
    },
    /**
     * Build the audio pool for every SFX up-front so the first user
     * interaction doesn't pay the network + decode cost. Safe to call
     * multiple times — buildPool() short-circuits on the second pass.
     */
    preload: () => {
        for (const name of ALL_SFX) {
            if (!POOL[name]) buildPool(name);
        }
    },
};

/**
 * Phase 11.5-A — schedule a single deferred preload on app boot.
 * Browsers (especially iOS Safari / Telegram WebView) gate <audio>
 * autoplay behind a real user gesture, so we ALSO fire preload on the
 * first pointerdown/keydown — that gesture is exactly what's needed to
 * unblock the upcoming play() calls. The idle-callback path covers
 * desktops that may never trigger a gesture before the first sound.
 */
let _scheduledPreload = false;
export function schedulePreload() {
    if (_scheduledPreload) return;
    _scheduledPreload = true;
    const fire = () => { try { sfx.preload(); } catch {} };
    if (typeof window === "undefined") return;
    // (a) Idle path — gives the main thread some breathing room first.
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(fire, { timeout: PRELOAD_IDLE_TIMEOUT });
    } else {
        setTimeout(fire, 800);
    }
    // (b) First-gesture path — also primes the autoplay gate on iOS.
    const gestureOnce = () => {
        fire();
        window.removeEventListener("pointerdown", gestureOnce, true);
        window.removeEventListener("keydown", gestureOnce, true);
        window.removeEventListener("touchstart", gestureOnce, true);
    };
    window.addEventListener("pointerdown", gestureOnce, true);
    window.addEventListener("keydown",     gestureOnce, true);
    window.addEventListener("touchstart",  gestureOnce, true);
}

export function useAudioPrefs() {
    const [s, setS] = useState(audioPrefs.get);
    useEffect(() => audioPrefs.subscribe(setS), []);
    return [s, audioPrefs.set, audioPrefs.toggleMute];
}
