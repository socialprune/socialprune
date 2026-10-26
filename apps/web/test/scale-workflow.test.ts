import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
test('quiet measurement workflow has only bounded read-only engine jobs and artifacts', async () => {
  const file = await readFile(
    resolve(
      import.meta.dirname,
      '../../../.github/workflows/scale-measure.yml',
    ),
    'utf8',
  );
  expect(file).toContain("branches: ['measure/**']");
  expect(file).toContain('workflow_dispatch:');
  expect(file).toContain('runs-on: ubuntu-latest');
  expect(file).toContain('engine: [firefox, webkit]');
  expect(file).toContain('run: [1, 2, 3]');
  expect(file).toContain('contents: read');
  expect(file).not.toMatch(
    /secrets\.|contents: write|deploy|pull_request_target/,
  );
  for (const line of file.split('\n').filter((line) => line.includes('uses:')))
    expect(line).toMatch(/@[a-f0-9]{40}/);
  expect(file).toContain('if: always()');
  expect(file).toContain('SP_SCALE_OUTPUT:');
  expect(file).toContain("SP_SCALE_SORT: ${{ inputs.sort || 'likes' }}");
  expect(file).toContain('e2e/scale.config.ts');
  expect(file).not.toContain('e2e/frame.config.ts');
  expect(file).toContain('scripts/frame-build-check.ts plain');
  expect(file).toContain(
    'feed-scale-${{ matrix.engine }}-${{ matrix.run }}-${{ github.sha }}',
  );
  expect(file).toContain(
    '${{ github.workspace }}/feed-scale-output/${{ matrix.engine }}-${{ matrix.run }}',
  );
});
