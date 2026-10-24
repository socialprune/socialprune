import { appendFile, mkdir, readFile, readdir, lstat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
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
import { attachDisplayRecovery } from './display-change.ts';
import type { PlatformWindowOwner } from './display-change.ts';
import { canonicalDataRoot, createDataRemoval } from './data-removal.ts';
import {
  DATA_REMOVAL_CHANNEL,
  DataRemovalRequestSchema,
} from '../data-removal-protocol.ts';

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
  platformWindow?: PlatformWindowOwner;
  removalReport?(result: {
    removed: number;
    failures: import('../data-removal-protocol.ts').DataRemovalRow[];
    retained: import('../data-removal-protocol.ts').DataRemovalRow[];
  }): Promise<void>;
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
  const dataDirectory = await canonicalDataRoot(options.dataDirectory);
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
  let loggingStopped = false;
  const record = (code: string) => {
    counts[code] = (counts[code] ?? 0) + 1;
    if (loggingStopped) return;
    const row = JSON.stringify({ code, count: counts[code] }) + '\n';
    logQueue = logQueue
      .then(() => appendFile(join(logs, 'desktop.ndjson'), row))
      .catch(() => {
        // Keep a value-free causal record even when the file cannot be written.
        console.error('DESKTOP_LOG_WRITE_FAILED');
      });
  };
  record('DATA_ROOT_CANONICALIZED');
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
      storeBuild: process.windowsStore === true,
      ...(placement ? { windowPlacement: placement.browser } : {}),
    },
    record,
  );
  let runView: RunView = { phase: 'idle', version: 0 };
  let engineClosing: Promise<void> | undefined;
  let activeRequests = 0;
  let removalQuitting = false;
  const closeEngine = () => (engineClosing ??= engine.close());
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
    appInfo: () => ({
      version: app.getVersion(),
      build: process.windowsStore === true ? 'store' : 'direct',
    }),
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
  const dispatchRequest = async (request: DesktopRequest) => {
    if (removal.busy || engineClosing)
      return {
        type: 'desktopFailed' as const,
        requestId: request.requestId,
        code: 'NOT_AVAILABLE' as const,
      };
    if (
      request.type === 'openLink' ||
      request.type === 'dataFolderOpen' ||
      request.type === 'appInfo'
    )
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
  const dispatch = async (request: DesktopRequest) => {
    activeRequests++;
    try {
      return await dispatchRequest(request);
    } finally {
      activeRequests--;
    }
  };
  const recovery = attachDisplayRecovery({
    events: screen,
    areas: () => screen.getAllDisplays().map((display) => display.workArea),
    appBounds: () => window.getBounds(),
    ...(options.platformWindow ? { owner: options.platformWindow } : {}),
    record,
  });
  const removal = createDataRemoval({
    root: dataDirectory,
    owner: window.webContents,
    async idle() {
      if (
        quitting ||
        engineClosing ||
        activeRequests ||
        !['idle', 'ended'].includes(runView.phase)
      )
        return false;
      if (options.platformWindow && (await options.platformWindow.current()))
        return false;
      // profileStatus probes Chromium's lock. Reject a planted parent/profile
      // link before asking the engine to inspect any profile name.
      for (const name of ['profiles', 'profiles/x', 'profiles/instagram']) {
        const stat = await lstat(join(dataDirectory, name)).catch(
          (error: unknown) => {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ENOENT'
            )
              return null;
            throw error;
          },
        );
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
          return false;
      }
      for (const platform of ['x', 'instagram'] as const) {
        const reply = await engine.request({
          request: {
            type: 'profileStatus',
            requestId: crypto.randomUUID(),
            platform,
          },
        });
        if (reply.type !== 'profileStatus' || reply.profile.inUse) return false;
      }
      return ['idle', 'ended'].includes(runView.phase);
    },
    async shutdown() {
      recovery.close();
      await closeEngine();
      await languageWriting;
      await logQueue;
      loggingStopped = true;
    },
    async report(result) {
      if (options.removalReport) return options.removalReport(result);
      const labels = dialogLabels(await selectedLocale());
      await dialog.showMessageBox(window, {
        type: result.failures.length ? 'warning' : 'info',
        title: 'SocialPrune',
        message: result.failures.length
          ? labels.removalPartial
          : labels.removalComplete,
        detail: [
          `${labels.removalRemoved} ${result.removed}`,
          ...result.failures.map(
            (row) => `${row.name}: ${labels.removalReasons[row.reason]}`,
          ),
          ...result.retained.map(
            (row) => `${labels.removalRetained} ${row.name}`,
          ),
        ]
          .join('\n')
          .slice(0, 16000),
        buttons: [labels.removalQuit],
        noLink: true,
      });
    },
    quit: () => {
      removalQuitting = true;
      app.quit();
    },
    record,
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
    createRouter(window.webContents, dispatch, record),
  );
  ipcMain.handle(
    DROP_CHANNEL,
    createDropHandler(
      window.webContents,
      async (message) => {
        if (removal.busy || engineClosing)
          return {
            type: 'desktopFailed' as const,
            requestId: message.request.requestId,
            code: 'NOT_AVAILABLE' as const,
          };
        activeRequests++;
        try {
          return await engine.request(message);
        } finally {
          activeRequests--;
        }
      },
      record,
    ),
  );
  ipcMain.handle(DATA_REMOVAL_CHANNEL, async (event, raw: unknown) => {
    if (!authorizedSender(event, window.webContents))
      return removal.handle(event, raw);
    const request = DataRemovalRequestSchema.parse(raw);
    if (
      request.type === 'confirm' &&
      request.locale !== (await selectedLocale())
    )
      return { type: 'failed', id: request.id, code: 'invalid' };
    return removal.handle(event, request);
  });
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
    if (removal.busy || engineClosing) return;
    appLanguage = value;
    record('LANGUAGE_REQUEST_ACCEPTED');
    languageWriting = languageWriting
      .then(() => writeLanguage(dataDirectory, value, record))
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
    if (removal.busy) {
      event.preventDefault();
      return;
    }
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
    if (removal.busy && !removalQuitting) {
      event.preventDefault();
      return;
    }
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
      recovery.close();
      await closeEngine();
      await languageWriting;
      await logQueue;
      ipcMain.removeHandler(REQUEST_CHANNEL);
      ipcMain.removeHandler(DROP_CHANNEL);
      ipcMain.removeHandler(DATA_REMOVAL_CHANNEL);
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
