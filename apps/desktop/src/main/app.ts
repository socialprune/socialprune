import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import { REQUEST_CHANNEL, RUN_VIEW_CHANNEL } from '../protocol.ts';
import { createRouter } from './router.ts';
import {
  APP_URL,
  DESKTOP_POLICY,
  isAppUrl,
  WINDOW_PREFERENCES,
} from './policy.ts';
import { launchEngine } from './engine.ts';

export interface DesktopOptions {
  dataDirectory: string;
  assets: string;
  preload: string;
  engine: string;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');

export async function startDesktop(options: DesktopOptions) {
  mkdirSync(options.dataDirectory, { recursive: true });
  app.setPath('userData', options.dataDirectory);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const counts: Record<string, number> = {};
  const logs = join(options.dataDirectory, 'logs');
  await mkdir(logs, { recursive: true });
  let logQueue = Promise.resolve();
  const record = (code: string) => {
    counts[code] = (counts[code] ?? 0) + 1;
    const row = JSON.stringify({ code, count: counts[code] }) + '\n';
    logQueue = logQueue
      .then(() => appendFile(join(logs, 'desktop.ndjson'), row))
      .catch(() => {
        // Keep a value-free causal record even when the file cannot be written.
        console.error('DESKTOP_LOG_WRITE_FAILED');
      });
  };
  const local = session.fromPartition('socialprune');
  local.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  local.setPermissionCheckHandler(() => false);
  local.webRequest.onBeforeRequest((details, callback) => {
    const cancel = !isAppUrl(details.url);
    if (cancel) record('NETWORK_REJECTED');
    callback({ cancel });
  });
  const files = new Map<string, { bytes: Buffer; type: string }>();
  for (const [name, type] of [
    ['index.html', 'text/html; charset=utf-8'],
    ['renderer.js', 'text/javascript; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
  ]) {
    if (name && type)
      files.set('/' + name, {
        bytes: await readFile(join(options.assets, name)),
        type,
      });
  }
  local.protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const file =
      isAppUrl(request.url) && request.method === 'GET' && !url.search
        ? files.get(url.pathname)
        : undefined;
    return new Response(file ? new Uint8Array(file.bytes) : null, {
      status: file ? 200 : 404,
      headers: {
        'Content-Type': file?.type ?? 'text/plain',
        'Content-Security-Policy': DESKTOP_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      },
    });
  });
  const engine = launchEngine(
    options.engine,
    join(options.dataDirectory, 'workspace', 'socialprune.sqlite'),
    record,
  );
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    title: 'SocialPrune',
    webPreferences: {
      ...WINDOW_PREFERENCES,
      session: local,
      preload: options.preload,
    },
  });
  window.removeMenu();
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
    record('NAVIGATION_REJECTED');
  });
  window.webContents.on('will-frame-navigate', (event) => {
    event.preventDefault();
    record('NAVIGATION_REJECTED');
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    record('WEBVIEW_REJECTED');
  });
  window.webContents.setWindowOpenHandler(() => {
    record('WINDOW_REJECTED');
    return { action: 'deny' };
  });
  ipcMain.handle(
    REQUEST_CHANNEL,
    createRouter(
      window.webContents,
      (request) => engine.request(request),
      record,
    ),
  );
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL() === APP_URL)
      window.webContents.send(RUN_VIEW_CHANNEL, { phase: 'idle' });
  });
  let quitting = false;
  let settled = false;
  app.on('before-quit', (event) => {
    if (settled) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void engine.close().then(async () => {
      await logQueue;
      ipcMain.removeHandler(REQUEST_CHANNEL);
      settled = true;
      app.quit();
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('second-instance', () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  await window.loadURL(APP_URL);
  window.show();
  return { window, engine, counts };
}
