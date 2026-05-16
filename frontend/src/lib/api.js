import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const ORIGIN = BACKEND_URL || "";

const STORAGE_KEY = "lydo_token";

export const tokenStore = {
    get: () => {
        try { return localStorage.getItem(STORAGE_KEY) || ""; }
        catch { return ""; }
    },
    set: (t) => {
        try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    },
    clear: () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
    },
};

/**
 * Resolve a server-returned image_url:
 *   "/static/cases/..." -> "<backend>/static/cases/..."
 *   "http(s)://..."     -> unchanged
 */
export function resolveImage(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return `${ORIGIN}${url}`;
}

export const http = axios.create({ baseURL: API });

http.interceptors.request.use((config) => {
    const t = tokenStore.get();
    if (t) config.headers.Authorization = `Bearer ${t}`;
    return config;
});

export async function authTelegram(initData) {
    const { data } = await http.post("/auth/telegram", { initData });
    tokenStore.set(data.token);
    return data;
}

export async function authDevLogin(telegram_id, username, first_name) {
    const { data } = await http.post("/auth/dev-login", null, {
        params: { telegram_id, username, first_name },
    });
    tokenStore.set(data.token);
    return data;
}

export async function fetchMe() {
    const { data } = await http.get("/me");
    return data;
}

export async function fetchBalance() {
    const { data } = await http.get("/wallet/balance");
    return data.balance_ton;
}

export async function fetchDepositAddress() {
    const { data } = await http.get("/wallet/deposit-address");
    return data;
}

export async function fetchVaultInfo() {
    const { data } = await http.get("/wallet/vault-info");
    return data;
}

export async function devCredit(amount) {
    const { data } = await http.post("/wallet/dev-credit", null, {
        params: { amount },
    });
    return data.balance_ton;
}

// ---- Cases / Fair / Inventory ----
export async function fetchCases() {
    const { data } = await http.get("/cases");
    return data;
}

export async function fetchCase(caseId) {
    const { data } = await http.get(`/cases/${caseId}`);
    return data;
}

export async function fetchFairCurrent() {
    const { data } = await http.get("/fair/current");
    return data;
}

export async function fairRotate() {
    const { data } = await http.post("/fair/rotate");
    return data;
}

export async function openCase(caseId, clientSeed) {
    const { data } = await http.post(`/cases/${caseId}/open`, {
        client_seed: clientSeed,
    });
    return data;
}

export async function fetchInventory({ status, rarity, case_id, sort = "date_desc", limit = 200, offset = 0 } = {}) {
    const params = { sort, limit, offset };
    if (status && status !== "all") params.status = status;
    if (rarity && rarity !== "all") params.rarity = rarity;
    if (case_id && case_id !== "all") params.case_id = case_id;
    const { data } = await http.get("/inventory", { params });
    return data; // { items: [...], totals: {...} }
}

export async function sellInventoryItem(invId) {
    const { data } = await http.post(`/inventory/${invId}/sell`);
    return data.balance_ton;
}

export async function withdrawInventoryItem(invId, destinationAddress) {
    const { data } = await http.post(`/inventory/${invId}/withdraw`, {
        destination_address: destinationAddress,
    });
    return data;
}

// ---- Phase 2 — Withdrawals ----
export async function fetchMyWithdrawals(status = "all") {
    const params = {};
    if (status && status !== "all") params.status = status;
    const { data } = await http.get("/withdrawals/me", { params });
    return data;
}

export async function cancelMyWithdrawal(wid) {
    const { data } = await http.post(`/withdrawals/${wid}/cancel`);
    return data;
}

// ---- Phase 2 — Admin ----
export async function adminListWithdrawals({ status = "all", search = "", sort = "requested_desc", limit = 50, offset = 0 } = {}) {
    const params = { sort, limit, offset };
    if (status && status !== "all") params.status = status;
    if (search) params.search = search;
    const { data } = await http.get("/admin/withdrawals", { params });
    return data;
}

export async function adminGetWithdrawal(wid) {
    const { data } = await http.get(`/admin/withdrawals/${wid}`);
    return data;
}

export async function adminStartWithdrawal(wid) {
    const { data } = await http.post(`/admin/withdrawals/${wid}/start`);
    return data;
}

export async function adminFulfillWithdrawal(wid, payload) {
    const { data } = await http.post(`/admin/withdrawals/${wid}/fulfill`, payload);
    return data;
}

export async function adminRejectWithdrawal(wid, rejectionReason) {
    const { data } = await http.post(`/admin/withdrawals/${wid}/reject`, {
        rejection_reason: rejectionReason,
    });
    return data;
}

export async function adminWithdrawalStats() {
    const { data } = await http.get("/admin/stats/withdrawals");
    return data;
}

// ---- Phase 1b ----
export async function fetchReferrals() {
    const { data } = await http.get("/referrals/me");
    return data;
}

export async function claimReferrals() {
    const { data } = await http.post("/referrals/claim");
    return data;
}

export async function openCaseBatch(caseId, clientSeed, count = 10) {
    const { data } = await http.post(`/cases/${caseId}/open-batch`, {
        client_seed: clientSeed,
        count,
    });
    return data;
}

export async function generateShareCard(rollId) {
    const { data } = await http.post(`/share-card/generate`, null, {
        params: { roll_id: rollId },
    });
    return data;
}

// ---- Phase 3a — Admin CRUD ----
export async function adminListCases() {
    const { data } = await http.get("/admin/cases");
    return data;
}
export async function adminGetCase(caseId) {
    const { data } = await http.get(`/admin/cases/${caseId}`);
    return data;
}
export async function adminCreateCase(payload) {
    const { data } = await http.post("/admin/cases", payload);
    return data;
}
export async function adminPatchCase(caseId, patch) {
    const { data } = await http.patch(`/admin/cases/${caseId}`, patch);
    return data;
}
export async function adminDeleteCase(caseId) {
    const { data } = await http.delete(`/admin/cases/${caseId}`);
    return data;
}
export async function adminCalibrateCase(caseId, targetEvPct) {
    const { data } = await http.post(`/admin/cases/${caseId}/calibrate`, { target_ev_pct: targetEvPct });
    return data;
}
export async function adminCaseStats(caseId) {
    const { data } = await http.get(`/admin/cases/${caseId}/stats`);
    return data;
}

export async function adminListItems({ rarity = "all", search = "" } = {}) {
    const params = {};
    if (rarity && rarity !== "all") params.rarity = rarity;
    if (search) params.search = search;
    const { data } = await http.get("/admin/items", { params });
    return data;
}
export async function adminCreateItem(payload) {
    const { data } = await http.post("/admin/items", payload);
    return data;
}
export async function adminPatchItem(slug, patch) {
    const { data } = await http.patch(`/admin/items/${slug}`, patch);
    return data;
}
export async function adminDeleteItem(slug) {
    const { data } = await http.delete(`/admin/items/${slug}`);
    return data;
}
export async function adminRefetchItemFromFragment(slug) {
    const { data } = await http.post(`/admin/items/${slug}/refetch-from-fragment`);
    return data;
}
export async function adminUploadItemImage(slug, file) {
    const fd = new FormData();
    fd.append("slug", slug);
    fd.append("file", file);
    const { data } = await http.post("/admin/items/upload-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
}

export async function adminGetSettings() {
    const { data } = await http.get("/admin/settings");
    return data;
}
export async function adminPatchSettings(patch) {
    const { data } = await http.patch("/admin/settings", patch);
    return data;
}

export async function adminPortalsAuth(authData) {
    const { data } = await http.post("/admin/portals/auth", { auth_data: authData });
    return data;
}
export async function adminPortalsTest() {
    const { data } = await http.post("/admin/portals/test");
    return data;
}

// ---- Phase 3b — Floor prices (public-ish) ----
export async function fetchFloorPrices(slug) {
    const params = {};
    if (slug) params.slug = slug;
    const { data } = await http.get("/floor-prices", { params });
    return data;
}
export async function adminFloorPriceStats(onlyDriftPct = 0) {
    const params = onlyDriftPct ? { only_drift_pct: onlyDriftPct } : {};
    const { data } = await http.get("/admin/floor-prices/stats", { params });
    return data;
}
export async function adminFloorRefreshNow() {
    const { data } = await http.post("/admin/floor-prices/refresh-now");
    return data;
}

// ---- Phase 3c — Maintenance ----
export async function adminMaintenanceSyncAll({ apply = true, refreshFirst = true, maxPayoutMultiplier, minBasketSize = 4 } = {}) {
    const params = { apply, refresh_first: refreshFirst };
    if (maxPayoutMultiplier !== undefined && maxPayoutMultiplier !== null && maxPayoutMultiplier !== "")
        params.max_payout_multiplier = Number(maxPayoutMultiplier);
    if (minBasketSize) params.min_basket_size = Number(minBasketSize);
    const { data } = await http.post("/admin/maintenance/sync-all", null, { params });
    return data;
}
export async function adminMaintenanceSyncFloors({ apply = true, refreshFirst = true } = {}) {
    const { data } = await http.post("/admin/maintenance/sync-floors-from-fragment", null, {
        params: { apply, refresh_first: refreshFirst },
    });
    return data;
}
export async function adminMaintenanceRecalibrateAll({ apply = true, maxPayoutMultiplier, minBasketSize = 4 } = {}) {
    const params = { apply };
    if (maxPayoutMultiplier !== undefined && maxPayoutMultiplier !== null && maxPayoutMultiplier !== "")
        params.max_payout_multiplier = Number(maxPayoutMultiplier);
    if (minBasketSize) params.min_basket_size = Number(minBasketSize);
    const { data } = await http.post("/admin/maintenance/recalibrate-all-cases", null, { params });
    return data;
}

// ---- Phase 4b — Daily Free Case ----
export async function freeCaseCooldown() {
    const { data } = await http.get("/cases/free_case/cooldown");
    return data;
}
// ---- Phase 4b — Leaderboards ----
export async function adminLeaderboard(view, period = "week", limit = 100) {
    const { data } = await http.get(`/leaderboard/${view}`, { params: { period, limit } });
    return data;
}
// ---- Phase 4b — Promo codes (user) ----
export async function promoRedeem(code) {
    const { data } = await http.post("/promo/redeem", { code });
    return data;
}
// ---- Phase 4b — Promo admin CRUD ----
export async function adminListPromos({ includeDisabled = true, type } = {}) {
    const params = { include_disabled: includeDisabled };
    if (type) params.type = type;
    const { data } = await http.get("/admin/promos", { params });
    return data;
}
export async function adminCreatePromo(payload) {
    const { data } = await http.post("/admin/promos", payload);
    return data;
}
export async function adminGetPromo(code) {
    const { data } = await http.get(`/admin/promos/${encodeURIComponent(code)}`);
    return data;
}
export async function adminPatchPromo(code, patch) {
    const { data } = await http.patch(`/admin/promos/${encodeURIComponent(code)}`, patch);
    return data;
}
export async function adminDeletePromo(code) {
    const { data } = await http.delete(`/admin/promos/${encodeURIComponent(code)}`);
    return data;
}
// ---- Phase 4b — Admin digest live preview ----
export async function adminDigestPreview(windowHours = 24) {
    const { data } = await http.get("/admin/digest/preview", { params: { window_hours: windowHours } });
    return data;
}

// ---- Phase 4a — Cases drift heatmap ----
export async function adminCasesHeatmap({ windowDays = 7 } = {}) {
    const { data } = await http.get("/admin/cases/heatmap", { params: { window_days: windowDays } });
    return data;
}
