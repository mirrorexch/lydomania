/**
 * Phase 7a — Crash WS client.
 *
 * Mirrors `rouletteWs` shape: opens an authenticated WS, dispatches messages
 * to onMessage(callback), exposes close().
 *
 * Backend message types:
 *   "state"     — full snapshot on connect
 *   "phase"     — phase change (betting → running → crashed → betting)
 *   "tick"      — live multiplier during running (10 Hz)
 *   "new_bet"   — another player placed a bet
 *   "cashout"   — a bet cashed out
 */

const WS_URL = (() => {
    const api = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
    const wsBase = api.replace(/^http/, "ws");
    return `${wsBase}/api/ws/crash`;
})();


export function openCrashSocket({ token, onMessage, onClose }) {
    // SECURITY: the token is sent in the first message frame (below), NOT in the
    // URL, so the JWT never lands in server access logs / Referer headers.
    const ws = new WebSocket(WS_URL);
    let closed = false;
    let pingTimer = null;

    ws.onopen = () => {
        // First frame MUST be the auth token (backend authenticate_ws reads it).
        try { ws.send(JSON.stringify({ token })); } catch {}
        // Mild keepalive every 25s — Telegram WebView can throttle idle WS.
        pingTimer = setInterval(() => {
            try { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); } catch {}
        }, 25_000);
    };

    ws.onmessage = (evt) => {
        if (evt.data === "pong") return;
        try {
            const msg = JSON.parse(evt.data);
            onMessage?.(msg);
        } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        onClose?.();
    };

    ws.onerror = () => { /* socket close will follow */ };

    return {
        close: () => {
            if (!closed) {
                closed = true;
                clearInterval(pingTimer);
                try { ws.close(); } catch {}
            }
        },
    };
}
