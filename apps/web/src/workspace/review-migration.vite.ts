// Test-only Vite configuration: no application plugins, profile, or production build.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  base: '/socialprune/',
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 4771, strictPort: true },
});
