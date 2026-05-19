/**
 * Phase 11 — Shared framer-motion variants.
 *
 * Drop-in reusable variants for cards, page sections, modals. Honors
 * prefers-reduced-motion globally by exporting `safe(variants)` which
 * collapses to no-op transitions when PRM is set.
 */
export const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const fadeInUp = {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: 8 },
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
};

export const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
    transition: { duration: 0.3 },
};

export const staggerChildren = (delay = 0.06) => ({
    animate: { transition: { staggerChildren: delay } },
});

export const cardHoverLift = {
    rest:  { y: 0, scale: 1 },
    hover: { y: -3, scale: 1.012 },
    tap:   { scale: 0.985 },
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
};

export const heroSheen = {
    initial: { opacity: 0, scale: 1.05 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
};

export const safe = (variants) => (PRM()
    ? { initial: false, animate: variants.animate || {}, transition: { duration: 0 } }
    : variants);
