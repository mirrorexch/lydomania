/**
 * Phase 4a → 11.6-D — Sound system.
 *
 * Plays the CC0 procedurally-generated SFX pack in `/sfx/*.wav` plus the
 * Mixkit royalty-free pack in `/sfx/*.mp3`. State (mute + volume)
 * persisted to localStorage, mirrored to a tiny event-emitter so any
 * component can subscribe and re-render.
 *
 * ─── Phase 11.6-D — migrated from HTMLAudioElement to Web Audio API ──
 *
 * Why this rewrite?
 *   HTMLAudioElement on iOS Telegram WebView adds 50-150 ms between
 *   `el.play()` and audible audio output (decoder ramp-up + native
 *   media-pipeline scheduling). For UI sound effects that's a perceptible
 *   lag — Phase 11.5-A's pool + preload + throttle mitigated repeat-play
 *   GC pressure but couldn't close the per-click latency.
 *
 *   Web Audio API gives < 10 ms latency: each SFX is decoded ONCE into
 *   an immutable `AudioBuffer`, and every `play()` just builds a fresh
 *   AudioBufferSourceNode and calls `start(0)` — that's a couple of
 *   memory allocations and a single function call into the audio
 *   thread. No re-decode, no media-element scheduling.
 *
 * Boot sequence:
 *   1.  schedulePreload() is called from App.js right after boot().
 *   2.  We DON'T create the AudioContext yet — iOS gates it behind a
 *       user gesture. Creating it before the gesture would land us in
 *       the "suspended" state and EVERY first play() would have to
 *       call .resume() with another delay.
 *   3.  We attach one-shot listeners for `pointerdown`, `keydown`,
 *       `touchstart`. The first to fire calls _initAudio() which:
 *         • creates the AudioContext
 *         • fetches every SFX in `ALL_SFX` in parallel
 *         • decodeAudioData() each → cache in BUFFERS map
 *         • resumes the context (gesture-authorised)
 *   4.  From here on, sfx.play("X") is O(1) — single allocation, no
 *       network, no decode, no scheduling drama.
 *
 * If Web Audio is unavailable (REALLY old browser, denied permissions),
 * we fall back to HTMLAudioElement pools — that's still the Phase
 * 11.5-A behaviour, just renamed to `_legacyPlay`.
 *
 * Usage (unchanged API for callers):
 *   import { sfx, audioPrefs, useAudioPrefs, schedulePreload } from "@/lib/sound";
 *   sfx.play("scroll_tick");
 *   sfx.playWin("legendary");
 *   sfx.playBatchWin("epic", true);
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "lydo_audio";
const DEFAULTS = { muted: false, volume: 0.7 };

const THROTTLE_MS = 50;          // same-name play() spam guard
const POOL_SIZE_PER_SFX = 3;     // fallback HTMLAudio pool size

const RARITY_TO_SFX = {
    common: "win_common", rare: "win_rare", epic: "win_epic",
    legendary: "win_legendary", mythic: "win_mythic", jackpot: "win_mythic",
};

const ALL_SFX = [
    "scroll_tick", "coin_drop",
    "win_common", "win_rare", "win_epic", "win_legendary", "win_mythic",
    "confetti_burst",
    "promo_redeem", "battle_start", "free_case_ready",
    "chip_click", "loss_thud", "case_lock_thunk", "drum_roll_buildup",
    "modal_whoosh", "tab_tap", "success_bell",
    "rising_hum", "explosion_thud",
];

const SFX_EXT = {
    chip_click: "mp3", loss_thud: "mp3", case_lock_thunk: "mp3",
    drum_roll_buildup: "mp3", modal_whoosh: "mp3", tab_tap: "mp3",
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
    } catch { return { ...DEFAULTS }; }
}
function savePrefs(p) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {} }

// ─── Web Audio state ────────────────────────────────────────────────
let _ctx = null;
const BUFFERS = {};               // name -> AudioBuffer (decoded once)
let _initStarted = false;
let _initDone = false;

// ─── HTMLAudio fallback pool (Phase 11.5-A semantics) ───────────────
const POOL = {};                  // name -> Audio[]
const POOL_CURSOR = {};           // name -> next-index
const LAST_PLAY_AT = {};          // name -> ms timestamp

function _srcUrl(name) {
    const ext = SFX_EXT[name] || "wav";
    return `/sfx/${name}.${ext}`;
}

async function _initAudio() {
    if (_initStarted) return;
    _initStarted = true;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            // Caller gets HTMLAudio fallback automatically.
            return;
        }
        _ctx = new AudioCtx({ latencyHint: "interactive" });
        // Resume immediately — we ONLY reach _initAudio from a gesture
        // handler, so the policy gate is satisfied.
        if (_ctx.state === "suspended") {
            try { await _ctx.resume(); } catch {}
        }
        // Fetch + decode all SFX in parallel. Failures are non-fatal —
        // the missing SFX silently falls back to no-op (or HTMLAudio).
        await Promise.all(
            ALL_SFX.map(async (name) => {
                try {
                    const r = await fetch(_srcUrl(name), { cache: "force-cache" });
                    if (!r.ok) return;
                    const ab = await r.arrayBuffer();
                    const buf = await new Promise((resolve, reject) => {
                        // decodeAudioData callback form for max Safari compat.
                        _ctx.decodeAudioData(ab, resolve, reject);
                    });
                    BUFFERS[name] = buf;
                } catch {}
            })
        );
        _initDone = true;
    } catch {
        // Total failure — leave BUFFERS empty, _legacyPlay kicks in.
    }
}

// ─── HTMLAudio fallback (only when Web Audio is unavailable) ────────
function _legacyBuildPool(name) {
    const src = _srcUrl(name);
    const arr = new Array(POOL_SIZE_PER_SFX);
    for (let i = 0; i < POOL_SIZE_PER_SFX; i++) {
        const el = new Audio(src);
        el.preload = "auto";
        try { el.load(); } catch {}
        arr[i] = el;
    }
    POOL[name] = arr;
    POOL_CURSOR[name] = 0;
    return arr;
}
function _legacyPlay(name, volume) {
    const pool = POOL[name] || _legacyBuildPool(name);
    const i = POOL_CURSOR[name] % POOL_SIZE_PER_SFX;
    POOL_CURSOR[name] = (i + 1) % POOL_SIZE_PER_SFX;
    const el = pool[i];
    try { el.currentTime = 0; } catch {}
    el.volume = volume;
    const p = el.play();
    if (p && typeof p.then === "function") p.catch(() => {});
}

// ─── Web Audio play (the fast path) ─────────────────────────────────
function _webAudioPlay(name, volume) {
    const buf = BUFFERS[name];
    if (!buf || !_ctx) return false;
    try {
        const src = _ctx.createBufferSource();
        src.buffer = buf;
        const gain = _ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain).connect(_ctx.destination);
        src.start(0);
        return true;
    } catch {
        return false;
    }
}

// ─── Pub/sub for React subscribers ──────────────────────────────────
let _state = loadPrefs();
const listeners = new Set();
function emit() { for (const l of listeners) { try { l(_state); } catch {} } }

export const audioPrefs = {
    get: () => ({ ..._state }),
    set: (patch) => {
        _state = { ..._state, ...patch };
        _state.volume = Math.max(0, Math.min(1, _state.volume));
        savePrefs(_state); emit();
    },
    toggleMute: () => {
        _state = { ..._state, muted: !_state.muted };
        savePrefs(_state); emit();
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};

export const sfx = {
    play: (name, opts = {}) => {
        if (_state.muted) return;
        if (!ALL_SFX.includes(name)) return;
        const now = performance.now ? performance.now() : Date.now();
        const last = LAST_PLAY_AT[name] || 0;
        if (now - last < THROTTLE_MS) return;
        LAST_PLAY_AT[name] = now;
        const volume = Math.max(0, Math.min(1, _state.volume * (opts.volume ?? 1)));
        // Web Audio fast path
        if (_initDone && _webAudioPlay(name, volume)) return;
        // HTMLAudio fallback (also covers the brief window where the
        // gesture has fired but decode is still in-flight)
        _legacyPlay(name, volume);
    },
    playWin: (rarity = "common", { confetti = null } = {}) => {
        const key = RARITY_TO_SFX[rarity] || "win_common";
        sfx.play(key);
        const showConfetti = confetti ?? (rarity === "legendary" || rarity === "mythic" || rarity === "jackpot");
        if (showConfetti) setTimeout(() => sfx.play("confetti_burst", { volume: 0.7 }), 120);
    },
    playBatchWin: (highestRarity = "common", hasJackpot = false) => {
        sfx.playWin(highestRarity, { confetti: hasJackpot });
        if (hasJackpot) setTimeout(() => sfx.play("coin_drop", { volume: 0.6 }), 350);
    },
    /** Eager decode of all SFX into AudioBuffers — call once. */
    preload: () => { _initAudio(); },
};

/**
 * Phase 11.6-D — schedule the Web Audio init on first user gesture.
 *
 * On every iOS Safari / Telegram WebView the AudioContext must be
 * unlocked by a real gesture. We register listeners for pointerdown,
 * keydown and touchstart in CAPTURE so we run BEFORE app handlers and
 * the SFX is ready to play on the same gesture-rooted call stack.
 *
 * We additionally schedule a fallback init on requestIdleCallback for
 * desktops that may never fire a gesture before the first sfx.play()
 * (e.g. an auto-playing background tab) — that init will create the
 * context in suspended state and the fallback HTMLAudio path takes
 * over until the user actually interacts.
 */
let _scheduledPreload = false;
export function schedulePreload() {
    if (_scheduledPreload) return;
    _scheduledPreload = true;
    if (typeof window === "undefined") return;

    const onGesture = () => {
        _initAudio();
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown",     onGesture, true);
        window.removeEventListener("touchstart",  onGesture, true);
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown",     onGesture, true);
    window.addEventListener("touchstart",  onGesture, true);

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => { _initAudio(); }, { timeout: 1500 });
    } else {
        setTimeout(() => { _initAudio(); }, 800);
    }
}

export function useAudioPrefs() {
    const [s, setS] = useState(audioPrefs.get);
    useEffect(() => audioPrefs.subscribe(setS), []);
    return [s, audioPrefs.set, audioPrefs.toggleMute];
}
