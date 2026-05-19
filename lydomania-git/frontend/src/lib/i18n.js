/**
 * Lydomania i18n bootstrap.
 *
 * - Loads en + ru resources.
 * - Detects language priority:
 *     1. localStorage['lydo_lang']  (user's explicit override)
 *     2. window.Telegram.WebApp.initDataUnsafe.user.language_code
 *     3. browser navigator
 *     4. fallback "en"
 * - Exposes setLanguage(lang) helper for the LanguageToggle.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import ru from "@/locales/ru.json";

const STORAGE_KEY = "lydo_lang";

function detect() {
    try {
        const stored = window.localStorage?.getItem(STORAGE_KEY);
        if (stored === "ru" || stored === "en") return stored;
    } catch {
        /* ignore */
    }
    try {
        const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
        if (typeof tgLang === "string" && tgLang.toLowerCase().startsWith("ru")) return "ru";
        if (typeof tgLang === "string") return "en";
    } catch {
        /* ignore */
    }
    try {
        const nav = (window.navigator?.language || "").toLowerCase();
        if (nav.startsWith("ru")) return "ru";
    } catch {
        /* ignore */
    }
    return "en";
}

const initial = detect();

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            ru: { translation: ru },
        },
        lng: initial,
        fallbackLng: "en",
        interpolation: { escapeValue: false }, // react already escapes
        returnEmptyString: false,
        react: { useSuspense: false },
    });

export function setLanguage(lang) {
    const normalized = lang === "ru" ? "ru" : "en";
    try {
        window.localStorage?.setItem(STORAGE_KEY, normalized);
    } catch {
        /* ignore */
    }
    i18n.changeLanguage(normalized);
    // Update <html lang=…> for accessibility / browser hints
    try {
        document.documentElement.setAttribute("lang", normalized);
    } catch {
        /* ignore */
    }
}

// Set <html lang> on boot too
try {
    document.documentElement.setAttribute("lang", initial);
} catch {
    /* ignore */
}

export default i18n;
