import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const out = join(tmpdir(), 'kilo', 'phase2', 'w0', 'probe-dist');

export default defineConfig({
  testDir: './test/probes',
  testMatch: 'violation.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4181', locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e-probe --outDir "${out}" --emptyOutDir && pnpm exec vite preview --outDir "${out}" --host 127.0.0.1 --port 4181 --strictPort`,
    url: 'http://127.0.0.1:4181/socialprune/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
