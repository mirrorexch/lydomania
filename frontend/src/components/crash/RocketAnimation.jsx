/**
 * Phase 11.7 — Crash rocket animation.
 *
 * Visual:
 *   ╭─────────────────────────────────────╮
 *   │  ✦ ⋆     ✧       ⋆  ✦   ⋆  ✧    ✦  │   ← static star-field (CSS)
 *   │      ✧                              │
 *   │            ⋆     ✦                  │
 *   │  ✦                  ⋆           ✧   │
 *   │                  ╱ ◢◣              │  ← rocket on parabolic trajectory
 *   │                ╱  ◤◥░░               │     (transform mutated via RAF)
 *   │              ╱   ░░░░░░              │
 *   │            ░░░░░░░░░░                │  ← orange/red trail behind rocket
 *   │   ◯───────────────────────────────   │
 *   ╰─────────────────────────────────────╯
 *
 * Why a separate component?
 *   The big multiplier number is already mutated directly in the DOM at
 *   ~60 Hz (Phase 11.2.1) to avoid React re-renders. The rocket has the
 *   SAME hot path — read `multiplierRef.current` every frame, recompute
 *   transform, write to the rocket's `style.transform` directly. No
 *   state, no React reconciliation, no layout thrash.
 *
 * Trajectory math:
 *   We use a log-scaled progress so the rocket moves a noticeable
 *   amount even at low multipliers (1.0 → 1.5×) and still has room to
 *   keep climbing at 10×, 30×, 100×.
 *
 *       progress = clamp(log(mul) / log(MAX_MUL), 0, 1)
 *
 *   The path is a quadratic Bezier from start (~50 %, 90 %) through a
 *   control point at (40 %, 30 %) to end at (88 %, 8 %). That gives a
 *   gentle "launch then climb" arc with a slight lean to the right.
 *
 * Crash behaviour:
 *   When phase=crashed, we cancel the RAF loop, freeze the rocket at
 *   its final position, and trigger an 8-particle CSS-keyframed
 *   explosion burst centred on the rocket. The rocket SVG itself
 *   fades to opacity 0 over 200 ms.
 *
 * Reduced motion:
 *   When `prefers-reduced-motion: reduce` is active we render a tiny
 *   static rocket icon centred at the top — no trajectory, no trail,
 *   no explosion. The multiplier number remains the focal point.
 */
import { useEffect, useRef } from "react";

// Path control points expressed as percentages of the stage box.
const START_X = 50,  START_Y = 92;        // bottom-centre launchpad
const CTRL_X  = 40,  CTRL_Y  = 32;        // control point for arc
const END_X   = 88,  END_Y   = 8;         // top-right escape
const MAX_MUL = 30;                       // multiplier at which arc reaches END

const _prm = () =>
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function quadraticBezier(t, a, b, c) {
    const inv = 1 - t;
    return inv * inv * a + 2 * inv * t * b + t * t * c;
}

export const RocketAnimation = ({ phase, multiplierRef, crashedX }) => {
    const stageRef  = useRef(null);
    const rocketRef = useRef(null);
    const burstRef  = useRef(null);
    const rafRef    = useRef(0);
    const prm       = useRef(_prm());

    useEffect(() => {
        // Stop any previous loop on phase change.
        cancelAnimationFrame(rafRef.current);
        if (prm.current) return;

        const rocket = rocketRef.current;
        const burst  = burstRef.current;
        if (!rocket) return;

        if (phase === "betting") {
            // Rocket on the launchpad, no animation.
            rocket.style.opacity = "0";
            rocket.style.transform = `translate(-50%, 0) translate(${START_X}cqw, ${START_Y}cqh) rotate(-32deg)`;
            if (burst) burst.style.opacity = "0";
            return;
        }

        if (phase === "crashed") {
            // Freeze rocket where it is, fade it out, fire the burst.
            // We re-read the multiplier ONE last time so the explosion
            // anchors to the position the rocket settled at.
            const x = Number(crashedX) || multiplierRef?.current || 1;
            const progress = Math.max(0, Math.min(1, Math.log(Math.max(1, x)) / Math.log(MAX_MUL)));
            const px = quadraticBezier(progress, START_X, CTRL_X, END_X);
            const py = quadraticBezier(progress, START_Y, CTRL_Y, END_Y);
            rocket.style.transform = `translate(-50%, -50%) translate(${px}cqw, ${py}cqh) rotate(${-32 + progress * 22}deg)`;
            // CSS handles the fade-out (class .crashed sets opacity:0 transition)
            rocket.classList.add("crashed");
            if (burst) {
                burst.style.left = `${px}%`;
                burst.style.top  = `${py}%`;
                burst.classList.remove("burst");
                // force reflow so the keyframe restarts on subsequent crashes
                void burst.offsetWidth;
                burst.classList.add("burst");
                burst.style.opacity = "1";
            }
            return;
        }

        // ── running phase: RAF loop ──
        rocket.classList.remove("crashed");
        rocket.style.opacity = "1";
        if (burst) burst.style.opacity = "0";

        const tick = () => {
            const x = multiplierRef?.current || 1;
            const progress = Math.max(0, Math.min(1, Math.log(Math.max(1, x)) / Math.log(MAX_MUL)));
            const px = quadraticBezier(progress, START_X, CTRL_X, END_X);
            const py = quadraticBezier(progress, START_Y, CTRL_Y, END_Y);
            // Lean from -32° at start to -10° near the top, so the rocket
            // looks like it's straightening up as gravity loses.
            const angle = -32 + progress * 22;
            rocket.style.transform = `translate(-50%, -50%) translate(${px}cqw, ${py}cqh) rotate(${angle}deg)`;
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [phase, crashedX, multiplierRef]);

    // PRM path — render only a tiny rocket dot, no scene.
    if (prm.current) {
        return null;
    }

    return (
        <div
            ref={stageRef}
            data-testid="crash-rocket-stage"
            className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl"
            style={{ containerType: "size" }}
        >
            {/* Star-field — pure CSS radial-gradients, three layers for parallax-y feel */}
            <div
                aria-hidden
                className="absolute inset-0"
                style={{
                    background: `
                        radial-gradient(1.5px 1.5px at 12% 20%, rgba(255,255,255,0.85), transparent 60%),
                        radial-gradient(1px 1px at 28% 70%, rgba(255,255,255,0.55), transparent 60%),
                        radial-gradient(1.5px 1.5px at 47% 15%, rgba(255,255,255,0.65), transparent 60%),
                        radial-gradient(1px 1px at 64% 55%, rgba(255,255,255,0.45), transparent 60%),
                        radial-gradient(1.2px 1.2px at 82% 30%, rgba(255,255,255,0.75), transparent 60%),
                        radial-gradient(1px 1px at 92% 75%, rgba(255,255,255,0.4), transparent 60%),
                        radial-gradient(1.4px 1.4px at 7% 78%, rgba(255,255,255,0.55), transparent 60%),
                        radial-gradient(1px 1px at 38% 42%, rgba(255,255,255,0.4), transparent 60%),
                        radial-gradient(1px 1px at 73% 88%, rgba(255,255,255,0.5), transparent 60%),
                        radial-gradient(1.6px 1.6px at 56% 88%, rgba(255,255,255,0.7), transparent 60%),
                        radial-gradient(900px 600px at 20% 110%, rgba(212,175,55,0.06), transparent 60%)
                    `,
                }}
            />
            {/* Rocket — wrapper is positioned absolutely at 0,0; transform
                in the useEffect translates it along the curve. */}
            <div
                ref={rocketRef}
                className="absolute top-0 left-0 will-change-transform transition-opacity duration-200 crash-rocket"
                style={{
                    width: "40px",
                    height: "40px",
                    opacity: 0,
                    transform: `translate(-50%, 0) translate(${START_X}cqw, ${START_Y}cqh) rotate(-32deg)`,
                }}
            >
                {/* Trail — sits BEHIND the rocket along the -rotation direction */}
                <div
                    aria-hidden
                    className="absolute right-full top-1/2 -translate-y-1/2 mr-1 w-16 h-2 rounded-full"
                    style={{
                        background: "linear-gradient(to left, rgba(255,160,80,0.95), rgba(255,90,40,0.5) 35%, transparent 100%)",
                        filter: "blur(2px)",
                    }}
                />
                <div
                    aria-hidden
                    className="absolute right-full top-1/2 -translate-y-1/2 mr-2 w-24 h-1 rounded-full"
                    style={{
                        background: "linear-gradient(to left, rgba(255,210,140,0.75), transparent 80%)",
                        filter: "blur(3px)",
                    }}
                />
                {/* Inline SVG rocket — body + window + fins + nozzle flame */}
                <svg viewBox="0 0 40 40" className="absolute inset-0 drop-shadow-[0_2px_8px_rgba(255,180,60,0.55)]" aria-hidden>
                    {/* nozzle flame */}
                    <ellipse cx="8" cy="20" rx="4" ry="3" fill="#fff6c2" />
                    <ellipse cx="6" cy="20" rx="6" ry="2.2" fill="#ffb13a" opacity="0.95" />
                    <ellipse cx="3" cy="20" rx="5" ry="1.3" fill="#ff6233" opacity="0.85" />
                    {/* rear fins */}
                    <polygon points="12,14 18,16 16,20 12,22" fill="#9a5c1f" />
                    <polygon points="12,26 18,24 16,20 12,18" fill="#7a4818" />
                    {/* body */}
                    <path d="M14 16 Q20 13 33 19 L33 21 Q20 27 14 24 Z" fill="#e8e8ea" stroke="#9aa0a8" strokeWidth="0.6" />
                    {/* nose cone */}
                    <path d="M33 19 L38 20 L33 21 Z" fill="#d44b3a" />
                    {/* window */}
                    <circle cx="24" cy="20" r="2" fill="#3aa7d4" />
                    <circle cx="24.6" cy="19.4" r="0.7" fill="#fff" opacity="0.7" />
                    {/* highlight band */}
                    <rect x="17" y="19.4" width="14" height="1.2" fill="#c7ced6" opacity="0.6" />
                </svg>
            </div>
            {/* Explosion burst — sits at rocket's last position when phase=crashed */}
            <div
                ref={burstRef}
                aria-hidden
                className="absolute pointer-events-none transition-opacity duration-200 crash-burst"
                style={{ width: 0, height: 0, opacity: 0 }}
            >
                {Array.from({ length: 10 }).map((_, i) => (
                    <span
                        key={i}
                        className="crash-burst-particle"
                        style={{ "--i": i, "--angle": `${i * 36}deg` }}
                    />
                ))}
                <span className="crash-burst-core" />
            </div>
        </div>
    );
};

export default RocketAnimation;
