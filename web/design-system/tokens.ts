// Synced copy of /design-system/tokens.ts. The web service builds with /web as
// its root (Railway), so it cannot import the shared file above that root.
// Keep this in sync with /design-system/tokens.ts; mobile still reads the root file.
export const shiftGoTokens = {
  // ─── Color System ───────────────────────────────────────────────────────
  color: {
    // Brand Scale: Modern Teal (Premium Enterprise)
    brand: {
      50: '#f0f9f7',
      100: '#d4ede8',
      200: '#a8ddd1',
      300: '#7ecab8',
      400: '#54b9a0',
      500: '#2a9984',
      600: '#1d7f6e',
      700: '#126655',
      800: '#0a4d3a',
      900: '#021e1a',
    },

    // Neutral Scale: Warm Gray (Premium Feel)
    neutral: {
      0: '#ffffff',
      25: '#fafaf9',
      50: '#f5f5f4',
      100: '#eeeeed',
      200: '#e1dedd',
      300: '#d0cac7',
      400: '#a09790',
      500: '#8b827a',
      600: '#6b6460',
      700: '#4d4640',
      800: '#2f2a27',
      900: '#1a1815',
    },

    // Semantic Colors: Status & Feedback
    success: {
      bg: '#ecfdf5',
      border: '#a7f3d0',
      text: '#065f46',
      solid: '#059669',
    },
    warning: {
      bg: '#fffbeb',
      border: '#fcd34d',
      text: '#92400e',
      solid: '#d97706',
    },
    danger: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#7f1d1d',
      solid: '#dc2626',
    },
    error: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#7f1d1d',
      solid: '#dc2626',
    },
    info: {
      bg: '#eff6ff',
      border: '#bfdbfe',
      text: '#1e3a8a',
      solid: '#2563eb',
    },

    // Shift Type Colors
    shiftType: {
      day: '#2a9984',           // brand-500
      wakeNight: '#a855f7',     // purple
      sleepIn: '#f97316',       // orange
      emergency: '#dc2626',     // red
    },

    // Dark Mode Palette
    darkMode: {
      bg: '#0f0e0d',
      surface: '#1a1815',
      surfaceElevated: '#2f2a27',
      border: '#423f3c',
      text: '#f5f5f4',
    },
  },

  // ─── Typography ─────────────────────────────────────────────────────────
  type: {
    display: 'Inter',      // Modern, geometric
    body: 'Inter',         // Highly legible
    data: 'IBM Plex Mono', // Monospace for numbers

    size: {
      xs: '0.6875rem',  // 11px
      sm: '0.75rem',    // 12px
      base: '0.875rem', // 14px
      lg: '1rem',       // 16px
      xl: '1.125rem',   // 18px
      '2xl': '1.5rem',  // 24px
      '3xl': '2rem',    // 32px
    },

    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
    },

    lineHeight: {
      tight: '1.2',
      normal: '1.4',
      relaxed: '1.5',
      loose: '1.75',
    },

    letterSpacing: {
      tighter: '-0.5px',
      tight: '-0.25px',
      normal: '0px',
    },
  },

  // ─── Spacing System ─────────────────────────────────────────────────────
  space: {
    xs: '0.125rem',  // 2px
    sm: '0.25rem',   // 4px
    md: '0.5rem',    // 8px
    lg: '0.75rem',   // 12px
    xl: '1rem',      // 16px
    '2xl': '1.5rem', // 24px
    '3xl': '2rem',   // 32px
    '4xl': '3rem',   // 48px
  },

  // ─── Corner Radius ──────────────────────────────────────────────────────
  radius: {
    none: '0px',
    xs: '2px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '9999px',
  },

  // ─── Shadows & Elevation ────────────────────────────────────────────────
  shadow: {
    none: 'none',
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 12px rgba(0, 0, 0, 0.08)',
    lg: '0 12px 24px rgba(0, 0, 0, 0.12)',
    xl: '0 20px 40px rgba(0, 0, 0, 0.16)',
  },

  elevation: {
    none: 'none',
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 12px rgba(0, 0, 0, 0.08)',
    lg: '0 12px 24px rgba(0, 0, 0, 0.12)',
    overlay: '0 20px 40px rgba(0, 0, 0, 0.16)',
  },

  // ─── Motion & Animation ─────────────────────────────────────────────────
  motion: {
    fast: '75ms',      // Quick micro-interactions
    base: '150ms',     // Hover states, icon changes
    normal: '200ms',   // Modal open/close
    slow: '300ms',     // Page transitions
    slower: '500ms',   // Complex sequences (rare)

    ease: {
      inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      out: 'cubic-bezier(0, 0, 0.2, 1)',
      in: 'cubic-bezier(0.4, 0, 1, 1)',
    },
  },

  // ─── Layout & Grid ──────────────────────────────────────────────────────
  layout: {
    container: {
      mobile: '100%',
      tablet: '42rem',    // max-w-2xl
      desktop: '64rem',   // max-w-5xl
      ultraWide: '80rem', // max-w-7xl
    },

    sidebar: {
      width: '240px',
      widthCollapsed: '60px',
    },

    header: {
      height: '56px',
    },

    row: {
      height: '44px', // Touch-friendly
    },
  },

  // ─── Breakpoints ────────────────────────────────────────────────────────
  breakpoint: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
} as const;

export type ShiftGoTokens = typeof shiftGoTokens;
