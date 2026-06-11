/**
 * Global "open deposit modal" trigger.
 *
 * The DepositModal lives in App.js with local state; this lets any page (e.g. an
 * insufficient-balance toast) open it without prop-drilling. App.js listens for
 * the `lydo:open-deposit` window event.
 */
export const OPEN_DEPOSIT_EVENT = "lydo:open-deposit";

export function openDeposit() {
    try {
        window.dispatchEvent(new CustomEvent(OPEN_DEPOSIT_EVENT));
    } catch {
        /* SSR / non-browser — no-op */
    }
}
