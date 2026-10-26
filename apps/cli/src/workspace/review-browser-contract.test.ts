import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('F3 migration subprocess assertions and labels follow the current workspace version', async () => {
  const source = await readFile(
    new URL('./test/review-browser.ts', import.meta.url),
    'utf8',
  );
  expect(source).toContain(
    'assert.equal(copy.workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION)',
  );
  expect(source).not.toMatch(
    /PASS (?:IndexedDB v6 to v10|v10 backup)|restores into schema 9/,
  );
});
