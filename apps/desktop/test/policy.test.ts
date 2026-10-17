import { expect, test } from 'vitest';
import {
  DESKTOP_POLICY,
  isAppUrl,
  WINDOW_PREFERENCES,
} from '../src/main/policy.ts';
import { verifyArchive } from '../packaging/fetch-electron.ts';
import { createHash } from 'node:crypto';

test('ADR-031 renderer preferences and policy are exact, including Trusted Types', () => {
  expect(DESKTOP_POLICY).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src app:; media-src app:; connect-src 'none'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune",
  );
  expect(WINDOW_PREFERENCES).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,
  });
  expect(isAppUrl('app://socialprune/index.html')).toBe(true);
  for (const url of [
    'https://socialprune/index.html',
    'app://socialprune.evil/index.html',
    'app://socialprune:123/a',
    'app://user@socialprune/a',
    'file:///a',
    'garbage',
  ])
    expect(isAppUrl(url)).toBe(false);
});

test('download checksum proof fails on changed bytes, wrong name and duplicate identity', () => {
  const bytes = Buffer.from('generated archive decoy');
  const sum = createHash('sha256').update(bytes).digest('hex');
  const sums = `${sum} *electron-v44.8.0-win32-x64.zip\n`;
  expect(() => verifyArchive(Buffer.from('changed'), sums)).toThrow(
    'ELECTRON_CHECKSUM_MISMATCH',
  );
  expect(() => verifyArchive(bytes, sums.replace('44.8.0', '44.8.1'))).toThrow(
    'ELECTRON_CHECKSUM_MISMATCH',
  );
  expect(() => verifyArchive(bytes, sums + sums)).toThrow(
    'ELECTRON_CHECKSUM_MISMATCH',
  );
  expect(verifyArchive(bytes, sums)).toBe(sum);
});
