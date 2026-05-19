/**
 * Phase 6h · Balance / number rollup.
 *
 * Uses framer-motion's animate() driver to interpolate from the previous
 * value to the next over `duration` seconds. Renders the live value through
 * a formatter (default = identity).
 *
 *   <RollingNumber value={balance} format={(n) => formatTON(n)} />
 *
 * Behaviour:
 *   • First mount: snaps to the initial value (no rollup, avoids a
 *     "0 → balance" jolt on cold load).
 *   • Subsequent changes: rolls from previous → next over 600 ms.
 *   • Honors `prefers-reduced-motion` → snaps instantly.
 */
import React, { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function RollingNumber({
    value,
    format = (n) => String(n),
    duration = 0.6,
    className = "",
    "data-testid": testid,
}) {
    const safe = Number.isFinite(value) ? value : 0;
    const [display, setDisplay] = useState(safe);
    const previous = useRef(safe);
    const firstMount = useRef(true);

    useEffect(() => {
        const from = previous.current;
        const to = safe;
        previous.current = to;
        if (firstMount.current) {
            firstMount.current = false;
            setDisplay(to);
            return undefined;
        }
        if (PRM()) { setDisplay(to); return undefined; }
        const controls = animate(from, to, {
            duration,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: (v) => setDisplay(v),
        });
        return () => controls.stop();
    }, [safe, duration]);

    return (
        <span data-testid={testid} className={className}>
            {format(display)}
        </span>
    );
}

export default RollingNumber;
