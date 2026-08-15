import type { Config } from 'tailwindcss';
import { shiftGoTokens } from '../design-system/tokens';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: shiftGoTokens.color.brand[50],
          100: shiftGoTokens.color.brand[100],
          200: shiftGoTokens.color.brand[200],
          300: shiftGoTokens.color.brand[300],
          400: shiftGoTokens.color.brand[400],
          500: shiftGoTokens.color.brand[500],
          600: shiftGoTokens.color.brand[600],
          700: shiftGoTokens.color.brand[700],
          800: shiftGoTokens.color.brand[800],
          900: shiftGoTokens.color.brand[900],
        },
        bg: shiftGoTokens.color.neutral[50],
        border: shiftGoTokens.color.neutral[200],
        fg: {
          DEFAULT: shiftGoTokens.color.neutral[900],
          muted: shiftGoTokens.color.neutral[600],
          subtle: shiftGoTokens.color.neutral[500],
          inverse: shiftGoTokens.color.neutral[0],
        },
        success: {
          bg: shiftGoTokens.color.success.bg,
          border: shiftGoTokens.color.success.border,
          text: shiftGoTokens.color.success.text,
          solid: shiftGoTokens.color.success.solid,
        },
        warning: {
          bg: shiftGoTokens.color.warning.bg,
          border: shiftGoTokens.color.warning.border,
          text: shiftGoTokens.color.warning.text,
          solid: shiftGoTokens.color.warning.solid,
        },
        danger: {
          bg: shiftGoTokens.color.danger.bg,
          border: shiftGoTokens.color.danger.border,
          text: shiftGoTokens.color.danger.text,
          solid: shiftGoTokens.color.danger.solid,
        },
        info: {
          bg: shiftGoTokens.color.info.bg,
          border: shiftGoTokens.color.info.border,
          text: shiftGoTokens.color.info.text,
          solid: shiftGoTokens.color.info.solid,
        },
        primary: {
          DEFAULT: shiftGoTokens.color.brand[600],
          container: shiftGoTokens.color.brand[50],
          fixed: shiftGoTokens.color.brand[200],
          'fixed-dim': shiftGoTokens.color.brand[300],
          inverse: shiftGoTokens.color.brand[200],
        },
        'on-primary': '#ffffff',
        'on-primary-container': '#abfff0',
        surface: {
          DEFAULT: shiftGoTokens.color.neutral[0],
          subtle: shiftGoTokens.color.neutral[50],
          muted: shiftGoTokens.color.neutral[100],
          raised: shiftGoTokens.color.neutral[0],
          dim: shiftGoTokens.color.neutral[200],
          bright: shiftGoTokens.color.neutral[50],
          lowest: shiftGoTokens.color.neutral[0],
          low: shiftGoTokens.color.neutral[100],
          DEFAULT2: shiftGoTokens.color.neutral[100],
          high: shiftGoTokens.color.neutral[200],
          highest: shiftGoTokens.color.neutral[300],
          variant: shiftGoTokens.color.neutral[200],
          tint: shiftGoTokens.color.brand[600],
        },
        'on-surface': shiftGoTokens.color.neutral[900],
        'on-surface-variant': shiftGoTokens.color.neutral[600],
        'inverse-surface': shiftGoTokens.color.neutral[800],
        'inverse-on-surface': shiftGoTokens.color.neutral[50],
        outline: {
          DEFAULT: shiftGoTokens.color.neutral[500],
          variant: shiftGoTokens.color.neutral[200],
        },
        secondary: {
          DEFAULT: '#565e71',
          container: '#d8dff5',
        },
        tertiary: {
          DEFAULT: '#784a00',
          container: '#996000',
        },
        'on-tertiary-container': '#ffecdb',
        error: {
          DEFAULT: shiftGoTokens.color.danger.solid,
          container: shiftGoTokens.color.danger.bg,
        },
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
      },
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-inter)', 'monospace'],
        inter: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: shiftGoTokens.radius.sm,
        DEFAULT: shiftGoTokens.radius.md,
        md: shiftGoTokens.radius.md,
        lg: shiftGoTokens.radius.lg,
        xl: shiftGoTokens.radius.lg,
      },
      boxShadow: {
        card: shiftGoTokens.elevation.none,
        button: shiftGoTokens.elevation.none,
        glass: shiftGoTokens.elevation.none,
        overlay: shiftGoTokens.elevation.overlay,
      },
      maxWidth: { container: '1440px' },
    },
  },
  plugins: [],
};

export default config;
