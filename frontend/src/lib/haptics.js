/**
 * Phase 6g · Step 9 — Telegram WebApp HapticFeedback wrapper.
 *
 * Telegram exposes `window.Telegram.WebApp.HapticFeedback` with three buckets:
 *   • impactOccurred(style)     — "light" | "medium" | "heavy" | "rigid" | "soft"
 *   • notificationOccurred(t)   — "success" | "warning" | "error"
 *   • selectionChanged()        — picker-style selection click
 *
 * Outside Telegram (desktop dev, web preview) every call becomes a no-op via
 * optional chaining, so wiring it everywhere is safe.
 *
 * Bot-API version gate: HapticFeedback is available from Mini App version 6.1+.
 * Older clients (rare in 2026) just no-op.
 *
 * Usage:
 *   import { tapLight, tapMedium, tapHeavy, notifySuccess } from "@/lib/haptics";
 *   onClick={() => { tapLight(); doThing(); }}
 */

const hf = () => {
    try {
        const wa = window?.Telegram?.WebApp;
        if (!wa?.HapticFeedback) return null;
        // Version gate: 6.1+. wa.isVersionAtLeast was added in 6.0.
        if (typeof wa.isVersionAtLeast === "function" && !wa.isVersionAtLeast("6.1")) {
            return null;
        }
        return wa.HapticFeedback;
    } catch {
        return null;
    }
};

const safe = (fn) => {
    try { fn?.(); } catch { /* haptics never throw in production */ }
};

export const tapLight     = () => safe(() => hf()?.impactOccurred?.("light"));
export const tapMedium    = () => safe(() => hf()?.impactOccurred?.("medium"));
export const tapHeavy     = () => safe(() => hf()?.impactOccurred?.("heavy"));
export const tapRigid     = () => safe(() => hf()?.impactOccurred?.("rigid"));
export const tapSoft      = () => safe(() => hf()?.impactOccurred?.("soft"));

export const notifySuccess = () => safe(() => hf()?.notificationOccurred?.("success"));
export const notifyWarning = () => safe(() => hf()?.notificationOccurred?.("warning"));
export const notifyError   = () => safe(() => hf()?.notificationOccurred?.("error"));

export const selectionChanged = () => safe(() => hf()?.selectionChanged?.());

/**
 * Convenience: pick an impact level from a rarity tier.
 * common/rare → light, epic → medium, legendary+ → heavy.
 */
export const tapForRarity = (rarity) => {
    if (rarity === "legendary" || rarity === "mythic" || rarity === "jackpot") {
        tapHeavy();
    } else if (rarity === "epic") {
        tapMedium();
    } else {
        tapLight();
    }
};

const haptics = {
    tapLight, tapMedium, tapHeavy, tapRigid, tapSoft,
    notifySuccess, notifyWarning, notifyError, selectionChanged,
    tapForRarity,
};
export default haptics;
