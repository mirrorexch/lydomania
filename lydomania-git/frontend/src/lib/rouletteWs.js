/**
 * Phase 6c — Roulette WebSocket client wrapper.
 *
 * Connects to /api/ws/roulette?token=<jwt> via the same origin as the
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


function wsUrl(token) {
    const u = new URL(BASE);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/ws/roulette";
    u.search = `?token=${encodeURIComponent(token)}`;
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
            socket = new WebSocket(wsUrl(realToken));
        } catch (e) {
            scheduleReconnect();
            return;
        }
        socket.onopen = () => { backoff = 1000; };
        socket.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                onMessage?.(data);
            } catch { /* ignore non-JSON */ }
        };
        socket.onclose = () => { if (!closed) scheduleReconnect(); };
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
