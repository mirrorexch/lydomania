// Telegram WebApp helpers — no SDK dependency, raw window.Telegram.WebApp.
// Provides: getInitData(), getTgUser(), isInTelegram(), isDevMode(), ready().

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

export function tgReady() {
    const tg = getTg();
    if (!tg) return;
    try {
        tg.ready();
        tg.expand?.();
        tg.setHeaderColor?.("#050507");
        tg.setBackgroundColor?.("#050507");
    } catch (e) {
        // ignore — older clients
    }
}
