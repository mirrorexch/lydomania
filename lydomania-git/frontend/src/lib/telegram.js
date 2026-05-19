// Telegram WebApp helpers — no SDK dependency, raw window.Telegram.WebApp.
// Provides: getInitData(), getTgUser(), isInTelegram(), isDevMode(), tgReady(),
//           requestFullscreenSafe(), exitFullscreenSafe(), getFullscreenPref(),
//           setFullscreenPref().

const FULLSCREEN_PREF_KEY = "lydomania:fullscreen";

export function getTg() {
    if (typeof window === "undefined") return null;
    return window.Telegram?.WebApp || null;
}

export function isInTelegram() {
    const tg = getTg();
    return Boolean(tg && tg.initData && tg.initData.length > 0);
}

export function isDevMode() {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("dev") === "1";
}

export function getInitData() {
    const tg = getTg();
    return tg?.initData || "";
}

export function getTgUser() {
    const tg = getTg();
    return tg?.initDataUnsafe?.user || null;
}

/**
 * Phase 6g · Step 11 — Fullscreen preference (persisted).
 * Default: ON. Returning `false` means the user explicitly opted out.
 */
export function getFullscreenPref() {
    try {
        const raw = localStorage.getItem(FULLSCREEN_PREF_KEY);
        if (raw === null) return true;                 // default = ON
        return raw === "1" || raw === "true";
    } catch {
        return true;
    }
}

export function setFullscreenPref(enabled) {
    try { localStorage.setItem(FULLSCREEN_PREF_KEY, enabled ? "1" : "0"); } catch {}
    const tg = getTg();
    if (!tg) return;
    try {
        if (enabled) tg.requestFullscreen?.();
        else tg.exitFullscreen?.();
    } catch { /* older clients — no-op */ }
}

/**
 * Bot API 8.0+ fullscreen. Returns true if the request was issued
 * (success is async via the `fullscreenChanged` / `fullscreenFailed` events).
 */
export function requestFullscreenSafe() {
    const tg = getTg();
    if (!tg || typeof tg.requestFullscreen !== "function") return false;
    try { tg.requestFullscreen(); return true; } catch { return false; }
}

export function exitFullscreenSafe() {
    const tg = getTg();
    if (!tg || typeof tg.exitFullscreen !== "function") return false;
    try { tg.exitFullscreen(); return true; } catch { return false; }
}

// Phase 6f / 6g — publish viewport height to CSS custom property so 100dvh
// fallbacks work on iOS Telegram where the WebView height changes when the
// keyboard or BottomBar shifts. Anything CSS-side reads --app-vh.
function _publishViewportHeight(tg) {
    const h = (tg && tg.viewportStableHeight) || window.innerHeight || 0;
    if (h > 0) {
        document.documentElement.style.setProperty("--app-vh", `${h}px`);
    }
}

let _viewportListenerAttached = false;
let _fullscreenListenerAttached = false;
let _fullscreenAttempted = false;       // ensure we never loop

export function tgReady() {
    // Always publish a baseline so even non-Telegram browsers get the var.
    _publishViewportHeight(null);
    window.addEventListener("resize", () => _publishViewportHeight(getTg()), { passive: true });

    const tg = getTg();
    if (!tg) return;
    try {
        tg.ready();
        tg.expand?.();                                    // legacy fallback (pre-8.0 clients)
        // Use brand bg color so the iOS notch / chin matches our dark theme.
        tg.setHeaderColor?.("#0a0a14");
        tg.setBackgroundColor?.("#0a0a14");
        // Phase 6f — stop "swipe down" from accidentally closing the Mini App
        // while users are scrolling case grids etc. Available on Telegram 7.7+.
        tg.disableVerticalSwipes?.();

        // Phase 6g · Step 11 — TRUE fullscreen on Bot API 8.0+ clients
        // (iOS/Android Telegram v10.9+, late 2024). Older clients have no
        // `requestFullscreen` method → optional chaining no-ops silently
        // and the existing `expand()` is the fallback.
        if (!_fullscreenAttempted && getFullscreenPref()) {
            _fullscreenAttempted = true;
            tg.requestFullscreen?.();
        }

        // Informational listeners only — DO NOT auto-re-request, otherwise
        // we'd fight the user if they intentionally exit fullscreen.
        if (!_fullscreenListenerAttached) {
            tg.onEvent?.("fullscreenChanged", () => {
                // Re-publish height because the safe-area changes in/out of fullscreen.
                _publishViewportHeight(tg);
            });
            tg.onEvent?.("fullscreenFailed", () => {
                // Silent: older clients or unsupported devices. expand() already ran.
            });
            _fullscreenListenerAttached = true;
        }

        _publishViewportHeight(tg);
        if (!_viewportListenerAttached) {
            tg.onEvent?.("viewportChanged", () => _publishViewportHeight(tg));
            _viewportListenerAttached = true;
        }
    } catch (e) {
        // ignore — older clients
    }
}
