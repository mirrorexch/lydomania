/**
 * Phase 6c — Roulette WebSocket client wrapper.
 *
 * Connects to /api/ws/roulette and authenticates by sending {token} in the
 * first message frame (the JWT is kept out of the URL). Same origin as the
 * backend. Falls back to REST polling of /api/roulette/state if the WS
 * fails to open or drops (reconnect-safe by design — server pushes a full
 * snapshot on every fresh connection).
 *
 * API:
 *   const conn = openRouletteSocket({ token, onState, onBet, onSettle });
 *   conn.close();
 */
import { tokenStore, http } from "@/lib/api";

const BASE = process.env.REACT_APP_BACKEND_URL || "";


function wsUrl() {
    // SECURITY: no token in the URL — it is sent in the first message frame.
    const u = new URL(BASE);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/ws/roulette";
    u.search = "";
    return u.toString();
}


export function openRouletteSocket({ token, onMessage }) {
    let socket = null;
    let closed = false;
    let pollTimer = null;
    let backoff = 1000;

    const realToken = token || tokenStore.get();
    if (!realToken) {
        // Fallback to pure REST polling
        const tick = async () => {
            if (closed) return;
            try {
                const r = await fetch(`${BASE}/api/roulette/state`);
                if (r.ok) {
                    const data = await r.json();
                    onMessage?.(data);
                }
            } catch { /* ignore */ }
            pollTimer = setTimeout(tick, 2500);
        };
        tick();
        return { close() { closed = true; if (pollTimer) clearTimeout(pollTimer); } };
    }

    const connect = () => {
        if (closed) return;
        try {
            socket = new WebSocket(wsUrl());
        } catch (e) {
            scheduleReconnect();
            return;
        }
        // Phase 11.2.1 — coalesce burst-y `new_bet` events into one batch per
        // animation frame so React doesn't re-render 30× when 30 bots fire
        // bets within the same betting window.
        let pendingBets = [];
        let coalesceRaf = 0;
        const flushPending = () => {
            coalesceRaf = 0;
            if (pendingBets.length === 0) return;
            const batch = pendingBets;
            pendingBets = [];
            // Forward as a single batch event; RoulettePage.jsx handles it.
            onMessage?.({ type: "new_bet_batch", bets: batch });
        };
        socket.onopen = () => {
            backoff = 1000;
            // First frame MUST be the auth token (backend authenticate_ws reads it).
            try { socket.send(JSON.stringify({ token: realToken })); } catch {}
        };
        socket.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                if (data.type === "new_bet") {
                    pendingBets.push(data);
                    if (!coalesceRaf) {
                        coalesceRaf = (typeof window !== "undefined" && window.requestAnimationFrame)
                            ? window.requestAnimationFrame(flushPending)
                            : setTimeout(flushPending, 100);
                    }
                    return;
                }
                onMessage?.(data);
            } catch { /* ignore non-JSON */ }
        };
        socket.onclose = () => {
            if (coalesceRaf) {
                if (typeof window !== "undefined" && window.cancelAnimationFrame) {
                    window.cancelAnimationFrame(coalesceRaf);
                } else {
                    clearTimeout(coalesceRaf);
                }
                coalesceRaf = 0;
            }
            if (!closed) scheduleReconnect();
        };
        socket.onerror = () => { try { socket?.close(); } catch {} };
    };

    const scheduleReconnect = () => {
        if (closed) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
    };

    connect();

    return {
        close() {
            closed = true;
            try { socket?.close(); } catch {}
            if (pollTimer) clearTimeout(pollTimer);
        },
        send(msg) {
            try { socket?.send(typeof msg === "string" ? msg : JSON.stringify(msg)); } catch {}
        },
    };
}
