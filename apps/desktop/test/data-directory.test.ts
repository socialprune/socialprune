import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { windowsShortPath } from './short-path.ts';

const electron = vi.hoisted(() => ({
  app: {
    enableSandbox: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => false),
    quit: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
}));
vi.mock('electron', () => ({
  ...electron,
  BrowserWindow: vi.fn(),
  dialog: {},
  ipcMain: {},
  screen: {},
  session: {},
  shell: {},
  MessageChannelMain: vi.fn(),
  utilityProcess: {},
}));
const { startDesktop } = await import('../src/main/app.ts');

test('main creates and canonicalizes an 8.3 data folder before setting Electron userData', async ({
  skip,
}) => {
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), 'socialprune-desktop-short-directory-')),
  );
  try {
    const short = await windowsShortPath(temporary);
    if (!short) {
      console.info(
        'SHORT_PATH_UNAVAILABLE: this volume offers no distinct Windows 8.3 alias.',
      );
      skip();
      return;
    }
    electron.app.setPath.mockClear();
    const selected = join(short, 'SocialPrune Data');
    await startDesktop({
      dataDirectory: selected,
      assets: '',
      preload: '',
      engine: '',
    });
    const canonical = await realpath(join(temporary, 'SocialPrune Data'));
    expect(selected).not.toBe(canonical);
    expect(electron.app.setPath).toHaveBeenCalledExactlyOnceWith(
      'userData',
      canonical,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
