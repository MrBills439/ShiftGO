import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#005f55',
          container: '#0d7a6e',
          fixed: '#99f3e4',
          'fixed-dim': '#7dd6c8',
          inverse: '#7dd6c8',
        },
        'on-primary': '#ffffff',
        'on-primary-container': '#abfff0',
        surface: {
          DEFAULT: '#f6faf8',
          dim: '#d7dbd9',
          bright: '#f6faf8',
          lowest: '#ffffff',
          low: '#f1f4f2',
          DEFAULT2: '#ebefec',
          high: '#e5e9e7',
          highest: '#dfe3e1',
          variant: '#dfe3e1',
          tint: '#006b60',
        },
        'on-surface': '#181c1b',
        'on-surface-variant': '#3e4947',
        'inverse-surface': '#2d3130',
        'inverse-on-surface': '#eef2ef',
        outline: {
          DEFAULT: '#6e7977',
          variant: '#bdc9c6',
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
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
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
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      boxShadow: {
        card: '0px 8px 24px rgba(26, 34, 50, 0.06)',
        button: '0px 4px 12px rgba(0, 95, 85, 0.25)',
        glass: '0px 2px 12px rgba(26, 34, 50, 0.08)',
      },
      maxWidth: { container: '1440px' },
    },
  },
  plugins: [],
};

export default config;
