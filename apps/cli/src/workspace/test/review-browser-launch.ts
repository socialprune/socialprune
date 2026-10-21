import type { BrowserType } from 'playwright-core';
export const bundledTestBrowser = (chromium: BrowserType) =>
  chromium.launch({ headless: true });
