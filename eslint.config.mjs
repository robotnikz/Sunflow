import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.e2e-data/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/sunflow-data/**',
      '**/sunflow-data-*/**',
      '**/data/**',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // This repo uses Node/browser globals across JS/TS files; TS already checks most of this.
      'no-undef': 'off',

      // Avoid busywork linting for regex/escaping in a TS-heavy project.
      'no-useless-escape': 'off',

      // Keep legacy switch/case blocks non-blocking.
      'no-case-declarations': 'warn',

      // React 17+ JSX transform: React import not required
      'react/react-in-jsx-scope': 'off',

      // Hooks correctness
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Keep lint low-friction for now
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
];
