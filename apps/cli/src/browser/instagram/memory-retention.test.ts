import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('C35 completed response bodies are unreachable before stop and after network disposal', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--expose-gc',
      fileURLToPath(
        new URL('./test/network-retention-probe.ts', import.meta.url),
      ),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  expect(JSON.parse(result.stdout) as unknown).toEqual({
    responses: 200,
    afterResponses: 0,
    afterDispose: 0,
  });
}, 30000);
