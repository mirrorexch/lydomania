import React from "react";
import { useTranslation } from "react-i18next";
import { setLanguage } from "@/lib/i18n";

/**
 * Tiny EN/RU pill toggle. Lives in the header between SoundToggle and the
 * Deposit button. Click flips language and persists to localStorage.
 */
export const LanguageToggle = ({ className = "" }) => {
    const { i18n, t } = useTranslation();
    const current = (i18n.language || "en").startsWith("ru") ? "ru" : "en";
    const next = current === "ru" ? "en" : "ru";

    const handle = () => setLanguage(next);

    return (
        <button
            type="button"
            onClick={handle}
            data-testid="language-toggle"
            aria-label={t("lang.switcher_aria")}
            title={t("lang.switcher_aria")}
            className={`inline-flex items-center w-9 h-8 rounded-md border text-[10px] font-black uppercase tracking-[0.12em] transition ${className}
                border-cyber-cyan/40 text-cyber-cyan bg-cyber-cyan/8 hover:bg-cyber-cyan/15`}
        >
            <span
                data-testid="language-toggle-current"
                className="flex-1 text-center"
            >
                {current === "ru" ? "RU" : "EN"}
            </span>
        </button>
    );
};

export default LanguageToggle;
