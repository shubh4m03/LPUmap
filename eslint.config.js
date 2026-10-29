import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
// Local rule (no dependency): layers and public entries of the module map (G-26/G-27).
import { moduleBoundariesPlugin } from './scripts/ci/eslint-module-boundaries.ts';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'playwright-report',
      'test-results',
      'public/data',
      'data/raw',
      '.wrangler',
      'reference',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never inject HTML; render text.',
        },
      ],
    },
  },
  {
    // Tests and scripts may reach module internals; app, server and function code may not.
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'functions/**/*.ts'],
    plugins: { atlas: moduleBoundariesPlugin },
    rules: { 'atlas/module-boundaries': 'error' },
  },
  {
    files: ['tests/**', 'scripts/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
