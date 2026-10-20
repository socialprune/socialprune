import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const out = mkdtempSync(join(tmpdir(), 'socialprune-probe-'));
process.once('exit', () => rmSync(out, { recursive: true, force: true }));
const port = Number(process.env['SP_E2E_PROBE_PORT'] ?? '4181');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid SP_E2E_PROBE_PORT.');
const origin = `http://127.0.0.1:${port}`;
let connectOptions: { wsEndpoint: string } | undefined;
// eslint-disable-next-line no-restricted-properties -- Probe-only endpoint inherited by its workers.
const inheritedEndpoint = process.env['SP_PROBE_QUIET_ENDPOINT'];
if (process.platform === 'win32' && inheritedEndpoint) {
  connectOptions = { wsEndpoint: inheritedEndpoint };
} else if (process.platform === 'win32') {
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('Probe port unavailable');
  connectOptions = {
    wsEndpoint: `ws://127.0.0.1:${address.port}/${randomUUID()}`,
  };
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
}

export default defineConfig({
  globalSetup: [
    './e2e/build-identity-setup.ts',
    '../cli/e2e/quiet-probe-setup.ts',
  ],
  metadata: { outputDirectory: out },
  testDir: './test/probes',
  testMatch: ['violation.spec.ts', 'store-contract.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: { baseURL: origin, locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit', connectOptions } },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e-probe --outDir "${out}" --emptyOutDir && pnpm exec vite preview --outDir "${out}" --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
