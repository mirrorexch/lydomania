import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";

// Reel geometry — must match .v-reelitem width + gap in vault.css.
const TILE_W = 92;
const GAP = 8;
const STRIP_LEN = 52;
const WIN_INDEX = 46; // winner lands here, near the end of the strip
const SPIN_MS = 5200;

// Weighted pick so the strip "feels" like real odds (cheap items dominate).
function weightedFill(basket, n, winner) {
    const pool = basket.filter((b) => b.slug !== winner.slug);
    const total = pool.reduce((s, b) => s + (b.weight || 1), 0) || 1;
    const out = [];
    for (let i = 0; i < n; i++) {
        let r = Math.random() * total;
        let chosen = pool[pool.length - 1] || winner;
        for (const b of pool) {
            r -= b.weight || 1;
            if (r <= 0) { chosen = b; break; }
        }
        out.push(chosen);
    }
    return out;
}

function Cell({ entry }) {
    const img = resolveImage(entry.image_url);
    return (
        <div className="v-reelitem" data-rarity={entry.rarity}>
            {img ? <img src={img} alt="" draggable={false} /> : <span className="emoji">🎁</span>}
            <span className="pz">{formatTON(entry.payout_ton, 0)}</span>
        </div>
    );
}

/**
 * VaultReel — Obsidian-styled horizontal open animation.
 * Props: basket (case basket entries), winner (winning_item from /open), onSettled().
 */
export const VaultReel = ({ basket, winner, onSettled }) => {
    const stripRef = useRef(null);
    const [done, setDone] = useState(false);

    const strip = useMemo(() => {
        const fill = weightedFill(basket, STRIP_LEN, winner);
        fill[WIN_INDEX] = { ...winner, weight: 1 };
        return fill;
    }, [basket, winner]);

    useLayoutEffect(() => {
        const el = stripRef.current;
        if (!el) return;
        const step = TILE_W + GAP;
        const viewport = el.parentElement.clientWidth;
        // center the winning tile under the pointer, with slight jitter
        const jitter = (Math.random() - 0.5) * (TILE_W * 0.5);
        const target = WIN_INDEX * step - viewport / 2 + TILE_W / 2 + jitter;

        // NOTE: intentionally ignore prefers-reduced-motion for the reel spin.
        // iOS Telegram WebView often forces Reduce Motion on at the system level,
        // which used to make the reel "teleport" straight to the prize with no
        // spin — killing the core open animation (same fix the wheel uses).
        // start offset (reset), then animate to target on next frame
        el.style.transition = "none";
        el.style.transform = "translateX(0px)";
        // force reflow so the transition applies
        void el.offsetWidth;
        el.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.62, 0.16, 1)`;
        el.style.transform = `translateX(${-target}px)`;
        const onEnd = () => { setDone(true); onSettled?.(); };
        el.addEventListener("transitionend", onEnd, { once: true });
        return () => el.removeEventListener("transitionend", onEnd);
    }, [strip, onSettled]);

    return (
        <div className={`v-reelbox${done ? " is-done" : ""}`}>
            <span className="v-pointer" />
            <div className="v-reelmask">
                <div className="v-reelstrip" ref={stripRef}>
                    {strip.map((e, i) => <Cell key={i} entry={e} />)}
                </div>
            </div>
        </div>
    );
};

export default VaultReel;
