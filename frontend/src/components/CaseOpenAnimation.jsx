import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { ItemTile } from "@/components/ItemTile";
import { rarityRank } from "@/lib/rarity";
import { sfx } from "@/lib/sound";

const TILE_W = 108;          // px
const STRIP_LEN = 55;        // tiles in the strip
const WIN_INDEX_MIN = 44;    // winner placed between [44..49] for slight variability
const WIN_INDEX_MAX = 49;
const DURATION_S = 5.6;

function pickRandomFromBasket(basket, n, exclude) {
    // basket entries weighted by `weight`; we pick by weight so the strip
    // "feels" representative of true odds (low-payout items dominate).
    const pool = basket.filter((b) => !exclude || b.slug !== exclude.slug);
    const total = pool.reduce((s, b) => s + (b.weight || 1), 0);
    const out = [];
    for (let i = 0; i < n; i++) {
        let r = Math.random() * total;
        for (const b of pool) {
            r -= (b.weight || 1);
            if (r <= 0) { out.push(b); break; }
        }
        if (out.length < i + 1) out.push(pool[pool.length - 1]);
    }
    return out;
}

/**
 * CaseOpenAnimation — CS:GO-style horizontal scroll.
 * Props:
 *   basket    : list of basket entries from /api/cases/{id}
 *   winner    : { slug, name, rarity, image_url, payout_ton }   (from /api/cases/{id}/open response)
 *   onSettled : called once when the strip stops on the winner
 */
export const CaseOpenAnimation = ({ basket, winner, onSettled }) => {
    const controls = useAnimation();
    const [phase, setPhase] = useState("idle"); // idle | spinning | settled
    const stripRef = useRef(null);

    const { strip, winIndex, finalX } = useMemo(() => {
        const winIdx = Math.floor(
            Math.random() * (WIN_INDEX_MAX - WIN_INDEX_MIN + 1)
        ) + WIN_INDEX_MIN;
        const filler = pickRandomFromBasket(basket, STRIP_LEN, winner);
        const winnerEntry = {
            slug: winner.slug,
            name: winner.name,
            rarity: winner.rarity,
            image_url: winner.image_url,
            payout_ton: winner.payout_ton,
            weight: 1,
        };
        filler[winIdx] = winnerEntry;

        // jitter: ±28px around exact center
        const jitter = (Math.random() - 0.5) * 56;
        // center of winning tile must align with viewport center.
        // strip's translateX = -(winIdx*TILE_W + TILE_W/2 - viewport_center) + jitter
        // We do not know viewport_center here; container is centered with overflow-hidden,
        // and the strip starts left-aligned with the container's left edge. We position
        // the indicator at container's center via CSS, and translate the strip by
        //    -(winIdx * TILE_W + TILE_W/2)
        // We then offset the strip's *initial* position so its center aligns with indicator.
        const x = -(winIdx * TILE_W + TILE_W / 2) + jitter;
        return { strip: filler, winIndex: winIdx, finalX: x };
    }, [basket, winner]);

    useEffect(() => {
        let mounted = true;
        // ---- Phase 4a · scroll ticks ----
        // Ticks decelerate with the strip — start fast, end slow.
        let tickTimer = null;
        const startTime = performance.now();
        const totalMs = (0.25 + DURATION_S + 0.18 + 0.22) * 1000;
        const minIntervalMs = 60;
        const maxIntervalMs = 320;
        const scheduleNext = () => {
            const elapsed = performance.now() - startTime;
            if (elapsed >= totalMs - 200) return;  // stop a touch before settle
            const t = Math.min(1, elapsed / totalMs);
            // ease-out cubic mirrors the strip
            const eased = 1 - Math.pow(1 - t, 3);
            const interval = minIntervalMs + (maxIntervalMs - minIntervalMs) * eased;
            tickTimer = setTimeout(() => {
                if (!mounted) return;
                sfx.play("scroll_tick", { volume: 0.55 });
                scheduleNext();
            }, interval);
        };
        scheduleNext();

        (async () => {
            setPhase("spinning");
            // entry: snap to far-left start then sweep right
            await controls.set({ x: 0, filter: "blur(0px)" });
            // small wind-up: jitter back a touch
            await controls.start({
                x: TILE_W * 2,
                filter: "blur(0.5px)",
                transition: { duration: 0.25, ease: "easeOut" },
            });
            // big spin
            await controls.start({
                x: finalX,
                filter: ["blur(3px)", "blur(2px)", "blur(0.4px)", "blur(0px)"],
                transition: {
                    duration: DURATION_S,
                    ease: [0.06, 0.7, 0.18, 0.999],  // hard ease-out
                    filter: { duration: DURATION_S, times: [0, 0.55, 0.85, 1] },
                },
            });
            // stutter-back: tiny overshoot then settle ("did I almost lose it?")
            await controls.start({
                x: finalX + 10,
                transition: { duration: 0.18, ease: [0.4, 0.0, 0.2, 1] },
            });
            await controls.start({
                x: finalX,
                transition: { duration: 0.22, ease: [0.4, 0.0, 0.2, 1] },
            });
            if (!mounted) return;
            setPhase("settled");
            onSettled?.();
        })();
        return () => {
            mounted = false;
            if (tickTimer) clearTimeout(tickTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finalX]);

    return (
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-cyber-bg" data-testid="case-roll-strip">
            {/* Side fades to soften the edges */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-cyber-bg to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-cyber-bg to-transparent z-10" />

            {/* Center indicator */}
            <div
                className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] z-20"
                style={{
                    background: "linear-gradient(180deg,#00F0FF,#8A2BE2)",
                    boxShadow: "0 0 18px rgba(0,240,255,0.7)",
                }}
            />
            <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 z-20">
                <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-cyber-cyan" />
            </div>
            <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 z-20 rotate-180">
                <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-cyber-purple" />
            </div>

            {/* Strip */}
            <motion.div
                ref={stripRef}
                animate={controls}
                style={{ display: "flex", gap: 0, width: STRIP_LEN * TILE_W, paddingLeft: "50%" }}
                className="will-change-transform"
            >
                {strip.map((entry, i) => (
                    <div
                        key={i}
                        style={{ width: TILE_W, height: TILE_W * 1.15, padding: 4 }}
                        className="flex-shrink-0"
                    >
                        <ItemTile
                            item={entry}
                            size="sm"
                            highlight={phase === "settled" && i === winIndex}
                        />
                    </div>
                ))}
            </motion.div>

            {/* Bottom hint */}
            <div className="absolute bottom-1.5 left-2 text-[9px] uppercase tracking-[0.2em] font-bold text-white/30 z-30">
                roll · {phase}
            </div>
        </div>
    );
};
