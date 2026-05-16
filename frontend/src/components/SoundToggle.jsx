/**
 * Phase 4a — Compact mute/unmute toggle.
 * Drop anywhere in nav, settings, etc. Persists via localStorage.
 */
import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAudioPrefs } from "@/lib/sound";

export function SoundToggle({ className = "", compact = false }) {
    const [prefs, setPrefs, toggleMute] = useAudioPrefs();
    const muted = prefs.muted;
    return (
        <div className={`inline-flex items-center gap-2 ${className}`} data-testid="sound-toggle">
            <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute sounds" : "Mute sounds"}
                aria-pressed={muted}
                data-testid="sound-mute-btn"
                className={`inline-flex items-center justify-center w-8 h-8 rounded-md border transition
                    ${muted
                        ? "border-white/15 text-white/40 hover:text-white/70 hover:border-white/30 bg-cyber-bg/40"
                        : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 bg-emerald-500/8"}`}
            >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            {!compact && (
                <input
                    type="range" min={0} max={100} step={1}
                    value={Math.round(prefs.volume * 100)}
                    onChange={(e) => setPrefs({ volume: Number(e.target.value) / 100 })}
                    disabled={muted}
                    aria-label="Volume"
                    data-testid="sound-volume-slider"
                    className="w-20 accent-emerald-400 disabled:opacity-30"
                />
            )}
        </div>
    );
}

export default SoundToggle;
