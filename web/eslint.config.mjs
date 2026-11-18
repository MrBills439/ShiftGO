// Accessibility lint (WCAG). Only jsx-a11y rules are enabled on purpose: this
// project has no general style lint, and this config exists to stop
// inaccessible markup (unlabelled controls, click-only divs, missing alt text)
// from coming back. Run: npm run lint:a11y
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'jsx-a11y': jsxA11y },
    settings: {
      'jsx-a11y': {
        // Our design-system wrappers render these native elements.
        components: { Button: 'button', Input: 'input', Select: 'select', Textarea: 'textarea' },
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Treat a wrapping <label> or htmlFor as enough; our inputs use both styles.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 3 }],
      // A scrollable region must be focusable so keyboard users can scroll it.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true }],
    },
  },
];
