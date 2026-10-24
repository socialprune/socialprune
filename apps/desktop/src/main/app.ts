import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { mkdirSync, realpathSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { guides } from 'socialprune/engine';
import {
  REQUEST_CHANNEL,
  RUN_VIEW_CHANNEL,
  DROP_CHANNEL,
  LOCALE_CHANNEL,
} from '../protocol.ts';
import { createRouter } from './router.ts';
import {
  APP_URL,
  DESKTOP_POLICY,
  isAppUrl,
  isAppDocument,
  WINDOW_PREFERENCES,
} from './policy.ts';
import { launchEngine } from './engine.ts';
import { loadReview } from './startup.ts';
import { mainMethods, splitWorkArea } from './methods.ts';
import { mediaResponse } from './media.ts';
import type { DesktopRequest, RunView } from '../protocol.ts';
import type { EngineFileSelection } from 'socialprune/engine';
import { importSelection } from './import-selection.ts';
import {
  dialogLocale,
  dialogLabels,
  openDialogOptions,
  saveDialogOptions,
} from './dialogs.ts';
import type { DialogLocale } from './dialogs.ts';
import { createDropHandler } from './drop.ts';
import { readLanguage, writeLanguage } from './language.ts';
import { authorizedSender } from './router.ts';

export interface DesktopOptions {
  dataDirectory: string;
  assets: string;
  preload: string;
  engine: string;
  dialogs?: {
    select(
      window: BrowserWindow,
      type: 'importExport' | 'backupExport' | 'backupRestore',
      locale: DialogLocale,
    ): Promise<EngineFileSelection>;
  };
  links?: {
    external(url: string): Promise<void>;
    folder(path: string): Promise<string>;
  };
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
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-proxy-server');

export async function startDesktop(options: DesktopOptions) {
  mkdirSync(options.dataDirectory, { recursive: true });
  // Windows may supply an 8.3 alias. Canonicalize before Electron or the
  // engine derives paths, without weakening the engine's profile link check.
  const dataDirectory = realpathSync.native(options.dataDirectory);
  app.setPath('userData', dataDirectory);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const counts: Record<string, number> = {};
  const logs = join(dataDirectory, 'logs');
  await mkdir(logs, { recursive: true });
  let appLanguage = await readLanguage(dataDirectory, app.getLocale());
  let languageWriting: Promise<void> = Promise.resolve();
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
  // The platform runs in a separate installed browser. Neither Electron
  // session needs proxy discovery or a network request, including at startup.
  for (const isolated of [session.defaultSession, local]) {
    await isolated.setProxy({ mode: 'direct' });
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const cancel = !isAppUrl(details.url);
      if (cancel) record('NETWORK_REJECTED');
      callback({ cancel });
    });
  }
  local.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  local.setPermissionCheckHandler(() => false);
  const files = new Map<string, { bytes: Buffer; type: string }>();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  const load = async (path = ''): Promise<void> => {
    for (const entry of await readdir(join(options.assets, path), {
      withFileTypes: true,
    })) {
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await load(name);
      else if (entry.isFile() && types[extname(name)])
        files.set('/' + name, {
          bytes: await readFile(join(options.assets, name)),
          type: types[extname(name)]!,
        });
    }
  };
  await load();
  local.protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith('/originals/') ||
      url.pathname.startsWith('/context/')
    )
      return mediaResponse(request, (message) => engine.media(message));
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
  const placement = splitWorkArea(
    screen.getDisplayMatching(window.getBounds()).workArea,
  );
  const engine = launchEngine(
    options.engine,
    {
      dataFolder: dataDirectory,
      ...(placement ? { windowPlacement: placement.browser } : {}),
    },
    record,
  );
  let runView: RunView = { phase: 'idle', version: 0 };
  engine.onRunView((view) => {
    if (
      view.phase === 'ended' &&
      (runView.phase !== 'ended' || runView.runId !== view.runId)
    )
      record(`RUN_ENDED_${view.end.detail ?? view.end.reason}`);
    runView = view;
    if (!window.isDestroyed() && isAppDocument(window.webContents.getURL()))
      window.webContents.send(RUN_VIEW_CHANNEL, view);
  });
  const localMethods = mainMethods({
    dataDirectory,
    guides,
    external: (url) =>
      options.links ? options.links.external(url) : shell.openExternal(url),
    folder: (path) =>
      options.links ? options.links.folder(path) : shell.openPath(path),
  });
  const selection = async (
    type: 'importExport' | 'backupExport' | 'backupRestore',
  ): Promise<EngineFileSelection> => {
    const locale = await selectedLocale();
    if (options.dialogs) {
      const result = await options.dialogs.select(window, type, locale);
      return result.type === 'importExport'
        ? importSelection(result.paths)
        : result;
    }
    if (type === 'backupExport') {
      const result = await dialog.showSaveDialog(
        window,
        saveDialogOptions(locale),
      );
      return { type, path: result.canceled ? null : (result.filePath ?? null) };
    }
    const result = await dialog.showOpenDialog(
      window,
      openDialogOptions(type, locale),
    );
    return type === 'importExport'
      ? importSelection(result.canceled ? null : result.filePaths)
      : { type, path: result.canceled ? null : (result.filePaths[0] ?? null) };
  };
  const selectedLocale = async (): Promise<DialogLocale> => {
    if (!window.isDestroyed() && isAppDocument(window.webContents.getURL())) {
      try {
        const value: unknown = await window.webContents.executeJavaScript(
          'document.documentElement.lang',
          false,
        );
        return dialogLocale(value, appLanguage);
      } catch {
        record('DIALOG_LANGUAGE_UNAVAILABLE');
      }
    }
    return appLanguage;
  };
  const dispatch = async (request: DesktopRequest) => {
    if (request.type === 'openLink' || request.type === 'dataFolderOpen')
      return localMethods(request);
    if (request.type === 'runAction' && request.action === 'start') {
      const split = splitWorkArea(
        screen.getDisplayMatching(window.getBounds()).workArea,
      );
      if (split) window.setBounds(split.app);
    }
    let selected: EngineFileSelection | undefined;
    if (
      request.type === 'importExport' ||
      request.type === 'backupExport' ||
      request.type === 'backupRestore'
    ) {
      try {
        selected = await selection(request.type);
      } catch {
        record('FILE_SELECTION_REJECTED');
        return {
          type: 'desktopFailed' as const,
          requestId: request.requestId,
          code: 'INVALID_ARCHIVE_PATH' as const,
        };
      }
    }
    const reply = await engine.request({
      request,
      ...(selected ? { selection: selected } : {}),
    });
    if ('view' in reply) runView = reply.view;
    return reply;
  };
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
    createRouter(window.webContents, dispatch, record),
  );
  ipcMain.handle(
    DROP_CHANNEL,
    createDropHandler(
      window.webContents,
      (message) => engine.request(message),
      record,
    ),
  );
  const documentLanguage = (
    event: import('electron').IpcMainEvent,
    value: unknown,
  ) => {
    if (
      !authorizedSender(event, window.webContents) ||
      (value !== 'en' && value !== 'de')
    ) {
      record('LANGUAGE_REJECTED');
      return;
    }
    appLanguage = value;
    languageWriting = languageWriting
      .then(() => writeLanguage(dataDirectory, value))
      .catch(() => {
        record('LANGUAGE_WRITE_FAILED');
      });
  };
  ipcMain.on(LOCALE_CHANNEL, documentLanguage);
  window.webContents.on('did-finish-load', () => {
    if (isAppDocument(window.webContents.getURL()))
      window.webContents.send(RUN_VIEW_CHANNEL, runView);
  });
  let quitting = false;
  let settled = false;
  let confirming = false;
  window.on('close', (event) => {
    if (quitting || ['idle', 'ended'].includes(runView.phase)) return;
    event.preventDefault();
    if (confirming) return;
    confirming = true;
    void selectedLocale()
      .then((locale) =>
        dialog.showMessageBox(window, {
          type: 'warning',
          title: 'SocialPrune',
          message: dialogLabels(locale).stopMessage,
          buttons: [dialogLabels(locale).stop, dialogLabels(locale).cancel],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }),
      )
      .then(({ response }) => {
        confirming = false;
        if (response === 0) app.quit();
      });
  });
  app.on('before-quit', (event) => {
    if (settled) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      if (
        !['idle', 'ended'].includes(runView.phase) &&
        runView.phase !== 'idle'
      ) {
        const current = runView;
        let settled = false;
        let finish!: () => void;
        const ended = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const remove = engine.onRunView((view) => {
          if (view.phase === 'ended' && view.runId === current.runId) {
            settled = true;
            finish();
          }
        });
        const timer = setTimeout(() => {
          record('ENGINE_STOP_TIMEOUT');
          finish();
        }, 30_000);
        try {
          const reply = await engine.request({
            request: {
              type: 'runAction',
              requestId: crypto.randomUUID(),
              runId: current.runId,
              version: current.version,
              action: 'stop',
            },
          });
          if (reply.type === 'desktopFailed') record('ENGINE_STOP_FAILED');
          if (
            !settled &&
            !(reply.type === 'runActionResult' && reply.view.phase === 'ended')
          )
            await ended;
        } finally {
          clearTimeout(timer);
          remove();
        }
      }
      await engine.close();
      await languageWriting;
      await logQueue;
      ipcMain.removeHandler(REQUEST_CHANNEL);
      ipcMain.removeHandler(DROP_CHANNEL);
      ipcMain.removeListener(LOCALE_CHANNEL, documentLanguage);
      settled = true;
      app.quit();
    })().catch(() => {
      record('ENGINE_CLOSE_FAILED');
      app.exit(1);
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('second-instance', () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  const loaded = await loadReview({
    contents: window.webContents,
    load: () => window.loadURL(APP_URL),
    dataDirectory,
    locale: () => appLanguage,
    message: (box) => dialog.showMessageBox(box),
    // Use before-quit, including its run Stop and engine settlement.
    quit: () => app.quit(),
  });
  if (loaded) window.show();
  return { window, engine, counts };
}
