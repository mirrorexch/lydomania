/**
 * Phase 6g · Step 11 — Fullscreen preference toggle.
 *
 * Switch lives in /profile → Preferences. Reads/writes localStorage via
 * helpers in `@/lib/telegram`. On change we either call
 * `tg.requestFullscreen()` (Bot API 8.0+) or `tg.exitFullscreen()`.
 * Outside Telegram (web preview) the helpers are no-ops, so the toggle still
 * works visually but has no platform effect.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2 } from "lucide-react";
import { tapLight } from "@/lib/haptics";
import {
    getFullscreenPref, setFullscreenPref,
} from "@/lib/telegram";

export function FullscreenToggle({ className = "", "data-testid": testid = "fullscreen-toggle" }) {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(() => getFullscreenPref());

    const onToggle = () => {
        const next = !enabled;
        tapLight();
        setFullscreenPref(next);
        setEnabled(next);
    };

    return (
        <button
            type="button"
            onClick={onToggle}
            data-testid={testid}
            aria-pressed={enabled}
            aria-label={t("profile.fullscreen_label")}
            className={`group inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition w-full
                ${enabled
                    ? "border-cyber-cyan/45 bg-cyber-cyan/10 text-cyber-cyan"
                    : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/25"}
                ${className}`}
        >
            {enabled
                ? <Maximize2 className="w-4 h-4 flex-shrink-0" />
                : <Minimize2 className="w-4 h-4 flex-shrink-0" />}
            <span className="text-[11px] font-bold uppercase tracking-wider flex-1 text-left">
                {t("profile.fullscreen_label")}
            </span>
            <span
                className={`relative inline-flex h-5 w-9 rounded-full transition flex-shrink-0
                    ${enabled ? "bg-cyber-cyan/70" : "bg-white/15"}`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform
                        ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`}
                />
            </span>
        </button>
    );
}

export default FullscreenToggle;
