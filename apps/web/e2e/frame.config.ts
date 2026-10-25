import { defineConfig } from '@playwright/test';
import scale from './scale.config.ts';
import { SCALE_PORT, SCALE_OUTPUT } from './scale-host.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  ...scale,
  testMatch: 'scale.measurement.ts',
  outputDir: join(SCALE_OUTPUT, 'frame-playwright'),
  webServer: {
    ...scale.webServer,
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    command: `pnpm exec vite build --mode e2e-frame && pnpm preview --host 127.0.0.1 --port ${SCALE_PORT} --strictPort`,
  },
});
