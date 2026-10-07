import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const out = join(tmpdir(), 'kilo', 'phase2', 'w0', 'probe-dist');
const port = Number(process.env['SP_E2E_PROBE_PORT'] ?? '4181');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid SP_E2E_PROBE_PORT.');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  globalSetup: './e2e/build-identity-setup.ts',
  metadata: { outputDirectory: out },
  testDir: './test/probes',
  testMatch: ['violation.spec.ts', 'store-contract.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: { baseURL: origin, locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e-probe --outDir "${out}" --emptyOutDir && pnpm exec vite preview --outDir "${out}" --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
