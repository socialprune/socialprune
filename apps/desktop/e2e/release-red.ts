import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNsis } from '../packaging/nsis.ts';
import { fetchNsis } from '../packaging/nsis-fetch.ts';
import { directory, dist } from '../packaging/paths.ts';
import { summarize, assertBudgets } from '../packaging/release-checks.ts';
import {
  assertNoOwnedNetwork,
  watchNetwork,
} from '../packaging/network-check.ts';
import { assertNsisTemp } from '../packaging/release-temp.ts';

// Intentionally exits nonzero. This file is never bundled into any app.
if (process.argv.includes('--budget')) {
  const measured = {
    startupMs: 2000,
    workingSetBytes: 500000000,
    installerBytes: 160000000,
  };
  assertBudgets(summarize(Array.from({ length: 5 }, () => ({ ...measured }))), {
    ...measured,
    startupMs: 1999,
  });
} else if (process.argv.includes('--listener')) {
  const monitor = await watchNetwork(
    join(dist, 'unused-install-root'),
    join(dist, 'red-listener.json'),
  );
  const server = createServer();
  try {
    server.listen(4669, '127.0.0.1');
    await once(server, 'listening');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assertNoOwnedNetwork(await monitor.stop());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await monitor.stop();
  }
} else if (process.argv.includes('--temp')) {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-temp-red-'));
  try {
    await writeFile(
      join(scratch, 'planted-extra.txt'),
      'generated unexpected file',
    );
    await assertNsisTemp(scratch, 0, '0'.repeat(64));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else if (process.argv.includes('--nsis-hash')) {
  await buildNsis(
    join(dist, 'release'),
    join(dist, 'must-not-build.exe'),
    '0.0.0',
    {
      source: join(directory, 'packaging/installer.nsi'),
      fetch: () => fetchNsis('0'.repeat(64)),
    },
  );
} else if (process.argv.includes('--nsis-compressor')) {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-compressor-red-'));
  try {
    const source = join(scratch, 'installer.nsi');
    await writeFile(
      source,
      (
        await readFile(join(directory, 'packaging/installer.nsi'), 'utf8')
      ).replace('SetCompressor zlib', 'SetCompressor lzma'),
    );
    await buildNsis(
      join(dist, 'release'),
      join(dist, 'must-not-build.exe'),
      '0.0.0',
      { source, fetch: fetchNsis },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else throw new Error('RED_VARIANT_REQUIRED');
