import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { quietWebKit } from './quiet-webkit.ts';

export { expect };
export const test = base.extend({
  browser: [
    async ({ browserName, playwright }, use) => {
      // eslint-disable-next-line no-restricted-properties -- Test-runner pause boundary.
      const stopFile = process.env['SP_TEST_STOP_FILE'];
      if (stopFile && existsSync(stopFile)) throw new Error('Test run paused');
      if (process.platform !== 'win32' || browserName !== 'webkit') {
        const browser = await playwright[browserName].launch({
          headless: true,
        });
        try {
          await use(browser);
        } finally {
          await browser.close();
        }
        return;
      }
      // WebKit's headless Windows embedder still calls SetForegroundWindow.
      // A separate desktop contains its native windows without switching ours.
      const server = await quietWebKit();
      try {
        const browser = await playwright.webkit.connect(server.endpoint);
        try {
          await use(browser);
        } finally {
          await browser.close();
        }
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
});
