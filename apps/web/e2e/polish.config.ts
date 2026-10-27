import { defineConfig } from '@playwright/test';
import base from './fit.config.ts';
export default defineConfig({ ...base, testMatch: 'polish.spec.ts' });
