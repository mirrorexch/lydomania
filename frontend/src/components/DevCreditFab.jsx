import React, { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { devCredit } from "@/lib/api";
import { toast } from "sonner";
import { isDevMode } from "@/lib/telegram";

/** Floating "+100 TON" debug button. Only renders when ?dev=1. */
export const DevCreditFab = ({ onCredited }) => {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    if (!isDevMode()) return null;

    const handle = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const newBal = await devCredit(100);
            onCredited?.(newBal);
            toast.success("+100 TON (dev)");
        } catch (e) {
            toast.error("dev-credit failed", { description: e?.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <motion.button
            data-testid="dev-credit-fab"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 16, stiffness: 240 }}
            onClick={handle}
            disabled={busy}
            aria-label={t("lang.switcher_aria") /* no own key — generic dev button */}
            className="fixed bottom-20 right-4 z-50 px-3 py-2 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-black text-xs font-black uppercase tracking-wider shadow-lg shadow-orange-500/40 hover:scale-110 active:scale-95 transition inline-flex items-center gap-1"
        >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            +100 TON
        </motion.button>
    );
};
