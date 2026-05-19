/**
 * Phase 10.3 — Mid-session achievement notification watcher.
 *
 * Fix-J: Persist the baseline `seen` set in localStorage keyed by user
 * telegram_id, so the first session unlock is NOT silently swallowed.
 *
 * On mount:
 *   - Read persisted set (if any) from localStorage.
 *   - Schedule first poll at 5s (was 60s); subsequent polls at 60s.
 *   - On each poll, diff against persisted set, toast new unlocks, persist.
 *
 * First-time user (no localStorage entry):
 *   - If first API response has 0 unlocked → empty baseline, any future
 *     unlock will toast.
 *   - If first API response has >0 unlocked → silent-seed those existing
 *     unlocks as the baseline so we don't spam legacy users on first visit
 *     after a deploy.
 *
 * Renders nothing — pure side-effects.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { http } from "@/lib/api";
import { sfx } from "@/lib/sound";
import { tapMedium } from "@/lib/haptics";

const FIRST_POLL_MS = 5_000;
const STEADY_POLL_MS = 60_000;
const LS_PREFIX = "lyd:ach_seen:";

const storageKey = (user) => {
    const tid = user?.telegram_id ?? user?.id ?? "anon";
    return `${LS_PREFIX}${tid}`;
};

const loadSeen = (user) => {
    try {
        const raw = localStorage.getItem(storageKey(user));
        if (!raw) return null;          // never-before-seen for this user
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return null;
    }
};

const saveSeen = (user, set) => {
    try {
        localStorage.setItem(storageKey(user), JSON.stringify(Array.from(set)));
    } catch {
        // localStorage may be full / disabled — non-fatal
    }
};

export const AchievementWatcher = ({ user }) => {
    const { t } = useTranslation();
    const seenRef = useRef(null);
    // null = uninitialised, false = no LS entry (fresh), true = LS hydrated
    const lsHydratedRef = useRef(false);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        // Hydrate baseline from localStorage (if any)
        const persisted = loadSeen(user);
        if (persisted) {
            seenRef.current = persisted;
            lsHydratedRef.current = true;
        } else {
            seenRef.current = null;     // will seed on first response
            lsHydratedRef.current = false;
        }

        const tick = async () => {
            try {
                const { data } = await http.get("/achievements/me");
                if (cancelled) return;
                const rows = data?.rows || [];
                const unlockedNow = new Set(
                    rows.filter((r) => r.unlocked).map((r) => r.achievement_id),
                );

                // First-ever response for this user (no LS entry)
                if (!lsHydratedRef.current && seenRef.current === null) {
                    // Distinguish "session-new" unlocks (unlocked_at within last 30s)
                    // from "historic" unlocks. Historic → silent-seed (no toast spam
                    // for legacy users). Session-new → continue to diff branch
                    // below so the toast fires.
                    const SESSION_WINDOW_MS = 30_000;
                    const nowMs = Date.now();
                    const historicIds = new Set();
                    const sessionNewRows = [];
                    rows.forEach((r) => {
                        if (!r.unlocked) return;
                        const ts = r.unlocked_at ? Date.parse(r.unlocked_at) : NaN;
                        if (Number.isFinite(ts) && (nowMs - ts) <= SESSION_WINDOW_MS) {
                            sessionNewRows.push(r);
                        } else {
                            historicIds.add(r.achievement_id);
                        }
                    });
                    seenRef.current = historicIds; // baseline = historic only
                    lsHydratedRef.current = true;
                    saveSeen(user, historicIds);
                    if (sessionNewRows.length === 0) {
                        return; // nothing fresh — wait for next poll
                    }
                    // Fall through: treat sessionNewRows as the diff so toast fires
                    // We continue into the main diff branch below by NOT returning.
                }

                const prev = seenRef.current || new Set();
                const newlyUnlocked = [];
                unlockedNow.forEach((id) => {
                    if (!prev.has(id)) {
                        const row = rows.find((r) => r.achievement_id === id);
                        if (row) newlyUnlocked.push(row);
                    }
                });

                if (newlyUnlocked.length > 0) {
                    sfx.play("success_bell", { volume: 0.45 });
                    tapMedium();
                    newlyUnlocked.forEach((row, i) => {
                        setTimeout(() => {
                            toast.success(t("achievement_toast.unlocked_title"), {
                                description: t("achievement_toast.unlocked_sub", {
                                    name: row.name || row.achievement_id,
                                }),
                                icon: React.createElement(Trophy, {
                                    className: "w-4 h-4 text-amber-300",
                                }),
                                duration: 4500,
                                action: {
                                    label: t("achievement_toast.claim_cta"),
                                    onClick: () => {
                                        window.location.href = "/achievements";
                                    },
                                },
                            });
                        }, i * 400);
                    });
                    // Merge into persisted set so reloading the page doesn't re-toast
                    newlyUnlocked.forEach((row) => prev.add(row.achievement_id));
                    seenRef.current = prev;
                    saveSeen(user, prev);
                } else {
                    // Still persist current unlocked snapshot so any concurrent
                    // unlock observed via another tab/process is also captured
                    seenRef.current = unlockedNow;
                    saveSeen(user, unlockedNow);
                }
            } catch {
                // silent — non-critical
            }
        };

        // Fast first poll (5s), then settle into 60s interval
        const firstTimer = setTimeout(() => {
            if (cancelled) return;
            tick();
        }, FIRST_POLL_MS);
        const id = setInterval(tick, STEADY_POLL_MS);
        return () => {
            cancelled = true;
            clearTimeout(firstTimer);
            clearInterval(id);
        };
    }, [user, t]);

    return null;
};

export default AchievementWatcher;
