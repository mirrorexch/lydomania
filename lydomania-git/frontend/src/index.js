import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import "@/index.css";
import App from "@/App";
import { TonConnectUIProvider } from "@tonconnect/ui-react";

if (typeof window !== "undefined" && !window.Buffer) {
    window.Buffer = Buffer;
}

const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <React.StrictMode>
        <TonConnectUIProvider
            manifestUrl={manifestUrl}
            // Phase 11 / Fix-M — gold-luxe theming so the TonConnect modal,
            // dropdown, focus rings, loader, and connect button bleed warm
            // gold instead of native TC teal/blue. THEME=DARK keeps the
            // glass panel + light text, colorsSet overrides the accents.
            uiPreferences={{
                theme: "DARK",
                colorsSet: {
                    DARK: {
                        constant: {
                            black: "#000000",
                            white: "#FFFFFF",
                        },
                        connectButton: {
                            background:    "#D4AF37",    // gold-500
                            foreground:    "#0B0905",
                        },
                        accent:             "#FFD700",   // gold-bright
                        telegramButton:     "#D4AF37",
                        icon: {
                            primary:        "#FFD700",
                            secondary:      "#E8C547",   // gold-400
                            tertiary:       "#B8860B",   // gold-600
                            success:        "#10B981",
                            error:          "#EF4444",
                        },
                        background: {
                            primary:        "#0A0A0A",
                            secondary:      "#13110C",
                            segment:        "#1C1810",
                            tint:           "rgba(212,175,55,0.08)",
                            qr:             "#FFFAEB",
                        },
                        text: {
                            primary:        "#FFFFFF",
                            secondary:      "#D4AF37",
                        },
                    },
                },
            }}
            actionsConfiguration={{
                twaReturnUrl: "https://t.me/lydomania777_bot",
            }}
        >
            <App />
        </TonConnectUIProvider>
    </React.StrictMode>,
);
