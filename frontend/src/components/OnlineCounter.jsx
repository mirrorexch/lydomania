/**
 * Phase 11.6-C — Online users counter widget.
 *
 * Polls /api/stats/online every 30 s and renders a compact pill:
 *
 *     ●  127 online
 *
 * The backend caches the count for 15 s, so the worst case is two
 * sequential polls hitting cached data. Aborts gracefully when the
 * window goes background (visibility API) to avoid wasted polls and
 * battery on iOS.
 */
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { API } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

export const OnlineCounter = () => {
    const { t } = useTranslation();
    const [count, setCount] = useState(null);

    useEffect(() => {
        let alive = true;
        let timer = null;

        const tick = async () => {
            try {
                const r = await fetch(`${API}/stats/online`, { credentials: "omit" });
                if (!r.ok) return;
                const j = await r.json();
                if (alive && typeof j.online === "number") setCount(j.online);
            } catch {}
        };
        const start = () => {
            tick();
            timer = setInterval(tick, POLL_INTERVAL_MS);
        };
        const stop = () => {
            if (timer) { clearInterval(timer); timer = null; }
        };
        const onVisibility = () => {
            if (document.hidden) stop();
            else if (!timer) start();
        };

        start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            alive = false;
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    if (count === null) return null;

    return (
        <div
            data-testid="online-counter"
            className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 text-[10px] uppercase tracking-wider font-bold tabular-nums"
            title={t("header.online_tooltip", { defaultValue: "Users active in the last 5 minutes" })}
        >
            <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]"
            />
            <Users className="w-3 h-3 opacity-80" aria-hidden="true" />
            <span data-testid="online-counter-value">{count.toLocaleString()}</span>
            <span className="opacity-80">{t("header.online_label", { defaultValue: "online" })}</span>
        </div>
    );
};

export default OnlineCounter;
