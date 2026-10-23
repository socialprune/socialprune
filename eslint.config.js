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
      '**/dist-review/**',
      'apps/web/dist-desktop/**',
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
  {
    files: ['packages/classify/src/**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...restrictedProperties,
        {
          object: 'os',
          property: 'homedir',
          message:
            'ADR-033: source configuration comes only from the named file.',
        },
        {
          object: 'os',
          property: 'userInfo',
          message: 'ADR-033: sources do not discover user identity.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:os',
              importNames: ['homedir', 'userInfo'],
              message: 'ADR-033: no ambient home or user discovery.',
            },
            {
              name: 'node:process',
              importNames: ['env'],
              message: 'ADR-033: no environment-based source or key.',
            },
          ],
          patterns: [
            {
              regex: '(?:^|/)workspace/review(?:\\.[cm]?[jt]s)?(?:/|$)',
              message:
                'ADR-033: sources cannot import the review decision-writing capability.',
            },
            {
              regex: '(?:^|/)test(?:/|$)|^vitest(?:/|$)',
              message:
                'ADR-033: production sources cannot import generated test endpoints.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'ADR-033: network access uses the caller-provided transport.',
        },
      ],
    },
  },
]);
