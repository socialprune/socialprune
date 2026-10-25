import { defineConfig } from '@playwright/test';
import frame from './frame.config.ts';
export default defineConfig({
  ...frame,
  testMatch: 'frame-controls.measurement.ts',
});
