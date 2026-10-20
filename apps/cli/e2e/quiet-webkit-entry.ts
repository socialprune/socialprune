import { webkit } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// This executable is selected only by the review test fixture.
const directory = process.argv[2]!;
// eslint-disable-next-line no-restricted-properties -- Test-runner pause boundary.
const stopFile = process.env['SP_TEST_STOP_FILE'];
if (stopFile && existsSync(stopFile)) process.exit(97);
const options = existsSync(join(directory, 'options.json'))
  ? (JSON.parse(await readFile(join(directory, 'options.json'), 'utf8')) as {
      port: number;
      wsPath: string;
    })
  : {};
const server = await webkit.launchServer({
  headless: true,
  host: '127.0.0.1',
  ...options,
});
try {
  await writeFile(
    join(directory, 'ready.json'),
    JSON.stringify({
      endpoint: server.wsEndpoint(),
      pid: server.process().pid,
    }),
  );
  while (!existsSync(join(directory, 'stop'))) await setTimeout(50);
} finally {
  await server.close();
}
