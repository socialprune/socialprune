import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const executionRules = {
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-implied-eval': 'error',
  'no-script-url': 'error',
};

export default defineConfig([
  {
    ignores: [
      '.kilo/**',
      'spikes/**',
      'fixtures/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    rules: executionRules,
  },
  {
    files: ['{apps,packages,tools}/**/*.{ts,tsx}', 'vitest.config.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...executionRules,
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'apps/**/*.{js,mjs,cjs,ts,tsx}',
      'packages/**/*.{js,mjs,cjs,ts,tsx}',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'AGENTS.md hard constraint 2: keys never come from the environment. Read only a key file the user explicitly names.',
        },
      ],
    },
  },
]);
