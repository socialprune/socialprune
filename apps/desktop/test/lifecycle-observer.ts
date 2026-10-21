import { app, type BrowserWindow } from 'electron';
import { appendFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const file = process.argv
  .find((arg) => arg.startsWith('--diagnostic-events='))
  ?.slice('--diagnostic-events='.length);
if (!file || !isAbsolute(file))
  throw new Error('DIAGNOSTIC_LIFECYCLE_FILE_REQUIRED');
const started = performance.now();
function record(event: string, fields: Record<string, unknown> = {}) {
  appendFileSync(
    file!,
    JSON.stringify({
      diagnosticOnly: true,
      event,
      at: Date.now(),
      elapsedMs: performance.now() - started,
      ...fields,
    }) + '\n',
  );
}
record('diagnostic-entry');
app.on('child-process-gone', (_event, details) =>
  record('child-process-gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  }),
);
app.on('browser-window-created', (_event, window: BrowserWindow) => {
  record('window-created', { id: window.id });
  window.on('ready-to-show', () => record('ready-to-show', { id: window.id }));
  window.on('show', () => record('show', { id: window.id }));
  window.on('unresponsive', () => record('unresponsive', { id: window.id }));
  window.webContents.on('did-start-loading', () => record('did-start-loading'));
  window.webContents.on('did-finish-load', () => record('did-finish-load'));
  window.webContents.on(
    'did-fail-load',
    (_event, code, _description, _url, isMainFrame) =>
      record('did-fail-load', { code, isMainFrame }),
  );
  window.webContents.on('render-process-gone', (_event, details) =>
    record('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  const original = window.loadURL.bind(window);
  window.loadURL = (...args) => {
    record('loadURL-called');
    return original(...args).then(
      () => {
        record('loadURL-settled');
      },
      (error: unknown) => {
        record('loadURL-rejected', {
          name: error instanceof Error ? error.name : 'unknown',
        });
        throw error;
      },
    );
  };
});
