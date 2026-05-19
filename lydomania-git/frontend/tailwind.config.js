/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        './pages/**/*.{js,jsx}',
        './components/**/*.{js,jsx}',
        './app/**/*.{js,jsx}',
        './src/**/*.{js,jsx}',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                // Phase 11 — Existing brand display (Unbounded) preserved so the
                // app-wide Bold/Condensed headlines do not collapse into a serif.
                display: ['Unbounded', 'Inter', 'system-ui', 'sans-serif'],
                // Phase 11 — Cormorant Garamond for hero numerals, jackpot
                // stats and section H1 accents (luxe casino feel).
                serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
                luxe:  ['"Cormorant Garamond"', 'Georgia', 'serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            colors: {
                // Phase 11 — Gold scale. CSS vars defined in styles/theme.css.
                gold: {
                    50:  'var(--gold-50)',
                    100: 'var(--gold-100)',
                    200: 'var(--gold-200)',
                    300: 'var(--gold-300)',
                    400: 'var(--gold-400)',
                    500: 'var(--gold-500)',
                    600: 'var(--gold-600)',
                    700: 'var(--gold-700)',
                    800: 'var(--gold-800)',
                    900: 'var(--gold-900)',
                    bright: 'var(--gold-bright)',
                },
                // Phase 11 — Warm-tinted near-black surface scale.
                surface: {
                    0: 'var(--surface-0)',
                    1: 'var(--surface-1)',
                    2: 'var(--surface-2)',
                    3: 'var(--surface-3)',
                },
                // Phase 11 — REMAP. Every existing `cyber-cyan` / `cyber-purple`
                // / `cyber-magenta` usage app-wide now resolves to the warm gold
                // palette. The 'cyber' namespace stays only to avoid a 100-file
                // rename; bg+surface stay the warm-tinted near-blacks.
                cyber: {
                    bg:       'var(--surface-0)',
                    surface:  'var(--surface-1)',
                    elevated: 'var(--surface-2)',
                    cyan:     'var(--gold-bright)',  // was #00F0FF → gold-bright
                    magenta:  'var(--danger)',
                    purple:   'var(--gold-600)',     // was #8A2BE2 → deep gold
                    ton:      'var(--gold-500)',     // was #0098EA → primary gold
                    success:  'var(--success)',
                    warning:  'var(--warn)',
                },
                // Phase 11 — Tailwind's built-in palettes that the legacy code
                // uses raw (e.g. `text-cyan-300`, `border-sky-400/40`,
                // `bg-teal-500/15`) ALSO get remapped to a warm gold scale so
                // no source-file rename is needed for the app-wide reskin.
                cyan: {
                    50:  '#FFFAEB', 100: '#FFF3CC', 200: '#FFEB99', 300: '#FFE066',
                    400: '#FFD700', 500: '#D4AF37', 600: '#B8860B', 700: '#8A6508',
                    800: '#5C4406', 900: '#3D2F08',
                },
                teal: {
                    50:  '#FFFAEB', 100: '#FFF3CC', 200: '#FFEB99', 300: '#FFE066',
                    400: '#FFD700', 500: '#D4AF37', 600: '#B8860B', 700: '#8A6508',
                    800: '#5C4406', 900: '#3D2F08',
                },
                sky: {
                    50:  '#FFFAEB', 100: '#FFF3CC', 200: '#FFEB99', 300: '#FFE066',
                    400: '#FFD700', 500: '#D4AF37', 600: '#B8860B', 700: '#8A6508',
                    800: '#5C4406', 900: '#3D2F08',
                },
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
            boxShadow: {
                // Phase 11 — Gold glow scale, warm and soft.
                'gold-glow':     '0 0 24px rgba(212,175,55,0.18)',
                'gold-glow-lg':  '0 8px 32px rgba(212,175,55,0.25)',
                'gold-glow-xl':  '0 16px 48px rgba(212,175,55,0.35)',
                'gold-inset':    'inset 0 0 0 1px rgba(212,175,55,0.30)',
                // Legacy neon shadows remapped to gold so existing classes still glow.
                'neon-cyan':    '0 0 25px rgba(255, 215, 0, 0.40)',
                'neon-purple':  '0 0 25px rgba(184, 134, 11, 0.40)',
                'neon-magenta': '0 0 25px rgba(239, 68, 68, 0.40)',
            },
            keyframes: {
                'accordion-down': {
                    from: { height: 0 },
                    to: { height: 'var(--radix-accordion-content-height)' },
                },
                'accordion-up': {
                    from: { height: 'var(--radix-accordion-content-height)' },
                    to: { height: 0 },
                },
                shimmer: {
                    '0%, 100%': { opacity: 0.5 },
                    '50%': { opacity: 1 },
                },
                'pulse-glow': {
                    '0%, 100%': { boxShadow: '0 0 10px rgba(212,175,55,0.30)' },
                    '50%':      { boxShadow: '0 0 25px rgba(255,215,0,0.65)' },
                },
                'marquee-scroll': {
                    '0%':   { transform: 'translateX(0)' },
                    '100%': { transform: 'translateX(-50%)' },
                },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up':   'accordion-up 0.2s ease-out',
                shimmer:          'shimmer 2.5s ease-in-out infinite',
                'pulse-glow':     'pulse-glow 2.5s ease-in-out infinite',
                'marquee-scroll': 'marquee-scroll 30s linear infinite',
            },
        },
    },
    plugins: [require('tailwindcss-animate')],
};
