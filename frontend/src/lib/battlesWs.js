/**
 * Phase 6d — Case Battles WebSocket clients.
 *
 * Two helpers:
 *   openBattlesLobbySocket({ onMessage }) — wide /lobby channel
 *   openBattleSocket(battleId, { onMessage }) — per-battle channel
 *
 * Each connects to /api/ws/battles/* with the user's JWT as a query param,
 * falls back to REST polling when WS is unavailable, and auto-reconnects
 * with exponential backoff.
 */
import { tokenStore } from "@/lib/api";

const BASE = process.env.REACT_APP_BACKEND_URL || "";

function wsUrl(path) {
    // SECURITY: no token in the URL — sent in the first message frame instead.
    const u = new URL(BASE);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = path;
    u.search = "";
    return u.toString();
}

function openSocket(path, { onMessage, pollFallbackFn }) {
    let socket = null;
    let closed = false;
    let pollTimer = null;
    let backoff = 1000;

    const token = tokenStore.get();
    if (!token) {
        // No token → REST poll only (pollFallbackFn may be null = give up)
        if (pollFallbackFn) {
            const tick = async () => {
                if (closed) return;
                try {
                    const data = await pollFallbackFn();
                    if (data) onMessage?.(data);
                } catch { /* ignore */ }
                pollTimer = setTimeout(tick, 3000);
            };
            tick();
        }
        return { close() { closed = true; if (pollTimer) clearTimeout(pollTimer); } };
    }

    const connect = () => {
        if (closed) return;
        try {
            socket = new WebSocket(wsUrl(path));
        } catch {
            scheduleReconnect();
            return;
        }
        socket.onopen = () => {
            backoff = 1000;
            // First frame MUST be the auth token (backend authenticate_ws reads it).
            try { socket.send(JSON.stringify({ token })); } catch {}
        };
        socket.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                onMessage?.(data);
            } catch { /* ignore */ }
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
    };
}


export function openBattlesLobbySocket({ onMessage }) {
    return openSocket("/api/ws/battles/lobby", {
        onMessage,
        pollFallbackFn: async () => {
            const r = await fetch(`${BASE}/api/battles?status=open,ready,rolling`);
            if (!r.ok) return null;
            const data = await r.json();
            return { type: "lobby_snapshot", rows: data.rows || [] };
        },
    });
}


export function openBattleSocket(battleId, { onMessage }) {
    return openSocket(`/api/ws/battles/${battleId}`, {
        onMessage,
        pollFallbackFn: async () => {
            const r = await fetch(`${BASE}/api/battles/${battleId}`);
            if (!r.ok) return null;
            const battle = await r.json();
            return { type: "snapshot", battle };
        },
    });
}
