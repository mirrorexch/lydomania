import React, { useEffect, useMemo, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { ItemTile } from "@/components/ItemTile";

const TILE_W = 96;
const STRIP_LEN = 40;
const WIN_INDEX_MIN = 30;
const WIN_INDEX_MAX = 35;
const STRIP_DURATION = 3.0;     // ~3s per strip
const STRIP_STAGGER = 0.35;     // each new strip starts 350ms after prior

function pickRandomFromBasket(basket, n, exclude) {
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

const SingleStrip = ({ basket, winner, delaySec, onSettled, rowIndex }) => {
    const controls = useAnimation();
    const { strip, finalX, winIndex } = useMemo(() => {
        const winIdx = Math.floor(Math.random() * (WIN_INDEX_MAX - WIN_INDEX_MIN + 1)) + WIN_INDEX_MIN;
        const filler = pickRandomFromBasket(basket, STRIP_LEN, winner);
        filler[winIdx] = {
            slug: winner.slug,
            name: winner.name,
            rarity: winner.rarity,
            image_url: winner.image_url,
            payout_ton: winner.payout_ton,
            weight: 1,
        };
        const jitter = (Math.random() - 0.5) * 36;
        const x = -(winIdx * TILE_W + TILE_W / 2) + jitter;
        return { strip: filler, finalX: x, winIndex: winIdx };
    }, [basket, winner]);
    const [settled, setSettled] = useState(false);

    useEffect(() => {
        let mounted = true;
        (async () => {
            await controls.set({ x: 0, filter: "blur(0px)" });
            await new Promise((res) => setTimeout(res, delaySec * 1000));
            await controls.start({
                x: finalX,
                filter: ["blur(2px)", "blur(1px)", "blur(0px)"],
                transition: {
                    duration: STRIP_DURATION,
                    ease: [0.08, 0.85, 0.2, 1],
                    filter: { duration: STRIP_DURATION, times: [0, 0.7, 1] },
                },
            });
            // tiny overshoot + settle
            await controls.start({
                x: finalX + 8,
                transition: { duration: 0.16, ease: "easeOut" },
            });
            await controls.start({
                x: finalX,
                transition: { duration: 0.18, ease: "easeOut" },
            });
            if (!mounted) return;
            setSettled(true);
            onSettled?.(rowIndex);
        })();
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finalX]);

    return (
        <div className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-cyber-bg/80 h-[80px]">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-cyber-bg to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-cyber-bg to-transparent z-10" />
            <div
                className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] z-20"
                style={{ background: "#FFD700", boxShadow: "0 0 10px rgba(255,215,0,0.7)" }}
            />
            <motion.div
                animate={controls}
                style={{ display: "flex", width: STRIP_LEN * TILE_W, paddingLeft: "50%", height: "100%" }}
                className="will-change-transform"
            >
                {strip.map((entry, i) => (
                    <div key={i} style={{ width: TILE_W, padding: 4 }} className="flex-shrink-0 h-full">
                        <ItemTile item={entry} size="sm" highlight={settled && i === winIndex} />
                    </div>
                ))}
            </motion.div>
        </div>
    );
};

/**
 * BatchOpenAnimation — N (typically 10) horizontal strips stacked vertically,
 * each one staggered by STRIP_STAGGER. Calls onAllSettled when every strip lands.
 */
export const BatchOpenAnimation = ({ basket, rolls, onAllSettled }) => {
    const [settledCount, setSettledCount] = useState(0);
    const handle = (i) => {
        setSettledCount((c) => {
            const next = c + 1;
            if (next >= rolls.length) onAllSettled?.();
            return next;
        });
    };
    return (
        <div className="space-y-1.5" data-testid="batch-roll-strips">
            {rolls.map((r, i) => (
                <SingleStrip
                    key={r.roll_id}
                    basket={basket}
                    winner={r.winning_item}
                    delaySec={i * STRIP_STAGGER}
                    rowIndex={i}
                    onSettled={handle}
                />
            ))}
        </div>
    );
};
