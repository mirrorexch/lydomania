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
            uiPreferences={{ theme: "DARK" }}
            actionsConfiguration={{
                twaReturnUrl: "https://t.me/lydomania777_bot",
            }}
        >
            <App />
        </TonConnectUIProvider>
    </React.StrictMode>,
);
