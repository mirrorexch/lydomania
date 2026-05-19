/**
 * Phase 11.1 — Shared "legendary win" celebration helper.
 *
 *   fireLegendaryBurst({ origin, intensity = "normal" })
 *
 * Tuned gold-only confetti burst driven off the already-installed
 * `canvas-confetti` dependency. Respects `prefers-reduced-motion`
 * (skips the visual burst but keeps the haptic + sound).
 *
 * Intensities:
 *   • "soft"   — single mid-density burst
 *   • "normal" — 3 cascading bursts (default)
 *   • "epic"   — 3 bursts + radial gold flash overlay (200ms) + heavy haptic
 */
import confetti from "canvas-confetti";

import { sfx } from "@/lib/sound";
import { tapHeavy, tapMedium } from "@/lib/haptics";

const GOLD_COLORS = ["#D4AF37", "#FFD700", "#B8860B", "#FFEB99"];

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const ensureFlashStyle = () => {
    if (typeof document === "undefined") return;
    if (document.getElementById("lyd-legendary-flash-style")) return;
    const s = document.createElement("style");
    s.id = "lyd-legendary-flash-style";
    s.innerHTML = `
        @keyframes lyd-legendary-flash {
            0%   { opacity: 0;    }
            30%  { opacity: 0.85; }
            100% { opacity: 0;    }
        }
        .lyd-legendary-flash {
            position: fixed; inset: 0; z-index: 9999;
            pointer-events: none;
            background: radial-gradient(circle at center,
                rgba(255,215,0,0.55) 0%,
                rgba(212,175,55,0.30) 25%,
                rgba(0,0,0,0)        65%);
            animation: lyd-legendary-flash 600ms ease-out forwards;
        }
    `;
    document.head.appendChild(s);
};

const playFlash = () => {
    if (typeof document === "undefined") return;
    ensureFlashStyle();
    const el = document.createElement("div");
    el.className = "lyd-legendary-flash";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
};

/**
 * Fire a tuned gold-themed confetti burst.
 *
 * @param {{origin?: {x:number,y:number}, intensity?: "soft"|"normal"|"epic"}} opts
 */
export function fireLegendaryBurst(opts = {}) {
    const { origin = { x: 0.5, y: 0.45 }, intensity = "normal" } = opts;

    // Always do haptic + sound (even when PRM disables the visual)
    try {
        if (intensity === "epic") tapHeavy();
        else tapMedium();
    } catch { /* */ }
    try {
        sfx.play(intensity === "epic" ? "case_legendary" : "success_bell",
                 { volume: intensity === "epic" ? 0.85 : 0.55 });
    } catch { /* */ }

    if (PRM()) return;

    // Burst 1 — large coin-like flakes
    confetti({
        particleCount: intensity === "epic" ? 130 : intensity === "soft" ? 50 : 90,
        spread: 75,
        startVelocity: intensity === "epic" ? 65 : 50,
        ticks: 220,
        gravity: 0.85,
        decay: 0.92,
        colors: GOLD_COLORS,
        shapes: ["circle"],
        scalar: intensity === "epic" ? 1.35 : 1.1,
        origin,
    });

    if (intensity !== "soft") {
        // Burst 2 — fine sparks, fired 120ms later
        setTimeout(() => {
            confetti({
                particleCount: intensity === "epic" ? 80 : 55,
                spread: 110, startVelocity: 35, ticks: 160, gravity: 1.05,
                decay: 0.94, colors: GOLD_COLORS,
                shapes: ["square"], scalar: 0.6,
                origin,
            });
        }, 120);
        // Burst 3 — slow drift star particles
        setTimeout(() => {
            confetti({
                particleCount: intensity === "epic" ? 50 : 35,
                spread: 140, startVelocity: 20, ticks: 320, gravity: 0.4,
                decay: 0.97, colors: GOLD_COLORS,
                shapes: ["star"], scalar: intensity === "epic" ? 1.2 : 0.9,
                origin: { x: origin.x, y: Math.max(0.1, origin.y - 0.05) },
            });
        }, 260);
    }

    if (intensity === "epic") {
        playFlash();
    }
}

export default fireLegendaryBurst;
