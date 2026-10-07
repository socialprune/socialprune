import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const executionRules = {
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-implied-eval': 'error',
  'no-script-url': 'error',
};

const restrictedProperties = [
  {
    object: 'process',
    property: 'env',
    message:
      'AGENTS.md hard constraint 2: keys never come from the environment. Read only a key file the user explicitly names.',
  },
];

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
    ignores: ['apps/*/playwright*.config.ts'],
    rules: {
      'no-restricted-properties': ['error', ...restrictedProperties],
    },
  },
  {
    // Runner ports only: these configs run in Node and are never bundled.
    // No key, token or credential may be read here.
    files: ['apps/*/playwright*.config.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...restrictedProperties.filter(
          ({ object, property }) => object !== 'process' || property !== 'env',
        ),
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(JSXAttribute[name.name="dangerouslySetInnerHTML"], Property[key.name="dangerouslySetInnerHTML"], Property[key.value="dangerouslySetInnerHTML"], MemberExpression[property.name="dangerouslySetInnerHTML"], MemberExpression[property.value="dangerouslySetInnerHTML"])',
          message:
            'ADR-004: render archive content as text nodes, never with dangerouslySetInnerHTML.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(?:^|/)test(?:/|$)',
              message:
                'ADR-004: production web source must not import test entries or probes.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/cli/src/commands/**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '(?:^@socialprune/core/(?:src/)?workspace/review(?:\\.[cm]?[jt]s)?(?:/|$)|(?:^|/)packages/core/src/workspace/review(?:\\.[cm]?[jt]s)?(?:/|$))',
              message:
                'ADR-017: CLI commands cannot import the review decision-writing capability. Use the label service.',
            },
          ],
        },
      ],
    },
  },
]);
