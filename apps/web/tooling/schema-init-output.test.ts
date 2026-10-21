import { expect, test } from 'vitest';
import { assertSchemaInitialization } from './schema-init-output.ts';
test('build control refuses a preloaded shared schema before jitless', async () => {
  const files = new Map([
    [
      'index.html',
      '<link rel="modulepreload" href="/socialprune/assets/shared.js">',
    ],
    [
      'assets/shared.js',
      `let jitless=false; function build(){if(!jitless) new Function('return 1')();} build(); export {jitless};`,
    ],
    ['assets/entry.js', `import './shared.js';`],
  ]);
  await expect(assertSchemaInitialization(files)).rejects.toThrow(
    'SCHEMA_INIT_ORDER',
  );
});
test('build control accepts schema construction after jitless', async () => {
  const files = new Map([
    [
      'index.html',
      '<link rel="modulepreload" href="/socialprune/assets/shared.js">',
    ],
    [
      'assets/shared.js',
      `let jitless=true; function build(){if(!jitless) new Function('return 1')();} build();`,
    ],
  ]);
  await expect(assertSchemaInitialization(files)).resolves.toBeUndefined();
});
