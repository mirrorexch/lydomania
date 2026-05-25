/**
 * Phase 11 — <ImageWithFallback>
 *
 * Drop-in <img> replacement that swaps to a gold-tinted SVG placeholder
 * when the source fails to load. Standardizes object-fit and a11y too.
 */
import React, { useState } from "react";

const DEFAULT_FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <defs>
                <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#B8860B"/>
                    <stop offset="100%" stop-color="#3D2F08"/>
                </linearGradient>
            </defs>
            <rect width="64" height="64" rx="10" fill="url(#g)" opacity="0.65"/>
            <path d="M16 44 L28 30 L36 38 L48 22"
                  stroke="#FFD700" stroke-width="2.5" fill="none"
                  stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
            <circle cx="22" cy="22" r="3.5" fill="#FFD700" opacity="0.85"/>
         </svg>`,
    );

export const ImageWithFallback = ({
    src, alt = "", fallback = DEFAULT_FALLBACK,
    className = "", objectFit = "cover", ...rest
}) => {
    const [errored, setErrored] = useState(false);
    return (
        <img
            src={errored ? fallback : (src || fallback)}
            alt={alt}
            draggable={false}
            // Phase 11.5-B — perf: defer both fetch (loading=lazy) AND
            // decode (decoding=async). Without decoding=async the browser
            // synchronously decodes the PNG on the main thread at first
            // paint, which on iOS Telegram WebView with 13 × ~1 MB case
            // PNGs adds ~200-500ms of jank to the cases list scroll.
            loading="lazy"
            decoding="async"
            onError={() => setErrored(true)}
            style={{ objectFit }}
            className={className}
            {...rest}
        />
    );
};

export default ImageWithFallback;
