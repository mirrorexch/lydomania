/**
 * Phase 6c — RouletteWheel: the CSGO-style strip wheel.
 *
 * Renders a wide horizontal strip composed of N repeats of the 15-segment
 * wheel layout. A center pointer marks the win position. During a spin we
 * `transform: translateX(-finalOffset)` over 8s with cubic-bezier ease-out,
 * landing the winning segment exactly under the pointer.
 *
 * Pure UI — drives off props.phase + props.segmentIndex; the parent owns
 * timing & lifecycle (drives off the engine's WebSocket events).
 *
 * BUGFIX (2026-05): the previous version added `mx-1` (4px) to each
 * segment, so the effective stride was 78 px while the math used 70 px.
 * That accumulated 8 × segment_index px of error — at index 14, the
 * pointer drifted ~112 px past the target segment, frequently landing on
 * the next/previous color. Now every cell is exactly SEGMENT_PX wide with
 * NO outer margin, and the landing math is extracted into a pure
 * `computeLandingOffset` for testability.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

export const WHEEL_SIZE = 15;
export const SEGMENT_PX = 70;        // exact stride — no margin
const REPEATS = 30;                  // 30 × 15 = 450 segments rendered
const LAND_REPEAT = 22;              // which repeat the wheel lands on
const SPIN_DURATION_S = 8.0;
const IDLE_OFFSET_PX = 2 * WHEEL_SIZE * SEGMENT_PX;
// Jitter must stay strictly inside the segment's safe inset (10% margin
// from each border so we can never visually drift to a neighbour).
const SAFE_INSET_RATIO = 0.10;
const JITTER_MAX_PX = SEGMENT_PX * (0.5 - SAFE_INSET_RATIO);   // 28 px max

const COLOR_CLASS = {
    red:   "bg-gradient-to-b from-rose-500 to-rose-700",
    black: "bg-gradient-to-b from-zinc-700 to-zinc-900",
    green: "bg-gradient-to-b from-emerald-400 to-emerald-600",
};

export function colorForIndex(i) {
    if (i === 0) return "green";
    return i % 2 === 1 ? "red" : "black";
}

/**
 * Pure landing-offset math. Exported for unit tests.
 *
 * Returns the `translateX(-N)` amount that places the CENTER of the
 * winning segment at viewport_center, plus a small deterministic jitter
 * bounded to [−JITTER_MAX_PX, +JITTER_MAX_PX] so two viewers don't see
 * pixel-identical landings.
 */
export function computeLandingOffset(segmentIndex, viewport, jitterSeed = 0) {
    const cellsBeforeTarget = LAND_REPEAT * WHEEL_SIZE + segmentIndex;
    const targetCenter = cellsBeforeTarget * SEGMENT_PX + SEGMENT_PX / 2;
    const jitter = Math.sin(segmentIndex * 37 + jitterSeed) * (JITTER_MAX_PX * 0.4);
    // round to integer px so subpixel anti-aliasing can't drift past a border
    return Math.round(targetCenter - viewport / 2 + jitter);
}

export const RouletteWheel = ({ phase, segmentIndex }) => {
    const ref = useRef(null);
    const [viewport, setViewport] = useState(900);
    const [offset, setOffset] = useState(IDLE_OFFSET_PX);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        const tick = () => {
            if (ref.current) setViewport(ref.current.clientWidth);
        };
        tick();
        window.addEventListener("resize", tick);
        return () => window.removeEventListener("resize", tick);
    }, []);

    const strip = useMemo(() => {
        const cells = [];
        for (let rep = 0; rep < REPEATS; rep++) {
            for (let i = 0; i < WHEEL_SIZE; i++) {
                cells.push({ rep, i, color: colorForIndex(i) });
            }
        }
        return cells;
    }, []);

    useEffect(() => {
        if (phase === "spinning" && Number.isInteger(segmentIndex)) {
            const target = computeLandingOffset(segmentIndex, viewport, viewport);
            setAnimating(true);
            setOffset(target);
            const t = setTimeout(() => setAnimating(false),
                (SPIN_DURATION_S + 0.2) * 1000);
            return () => clearTimeout(t);
        }
        if (phase === "betting" || phase === "locking") {
            setAnimating(false);
            setOffset(IDLE_OFFSET_PX);
        }
    }, [phase, segmentIndex, viewport]);

    const stripStyle = {
        transform: `translateX(${-offset}px)`,
        transition: animating
            ? `transform ${SPIN_DURATION_S}s cubic-bezier(0.16, 0.84, 0.24, 1.0)`
            : "transform 0s",
        willChange: "transform",
    };

    return (
        <div
            ref={ref}
            data-testid="roulette-wheel"
            className="relative w-full h-[110px] sm:h-[130px] overflow-hidden rounded-2xl border border-white/10 bg-cyber-surface"
        >
            <div className="absolute left-1/2 -translate-x-1/2 top-0 z-20 flex flex-col items-center pointer-events-none">
                <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[14px] border-t-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 z-20 flex flex-col items-center pointer-events-none">
                <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[14px] border-b-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
            </div>
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-300/60 z-10 pointer-events-none shadow-[0_0_10px_rgba(34,211,238,0.6)]" />

            <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-cyber-bg/95 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-cyber-bg/95 to-transparent z-10 pointer-events-none" />

            <div className="absolute inset-y-0 flex items-center" style={stripStyle}>
                {strip.map((cell, idx) => (
                    <div
                        key={idx}
                        style={{
                            width: `${SEGMENT_PX}px`,
                            height: `${SEGMENT_PX}px`,
                            marginLeft: 0,
                            marginRight: 0,
                            flexShrink: 0,
                        }}
                        className={`rounded-lg ${COLOR_CLASS[cell.color]} border border-black/40 shadow-inner flex items-center justify-center font-display font-bold text-white/90 text-base`}
                    >
                        {cell.color === "green" ? "★" : cell.i.toString().padStart(2, "0")}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default RouletteWheel;
