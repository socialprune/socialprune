import { app, dialog } from 'electron';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { APP_URL } from '../src/main/policy.ts';

// Only the startup test entry imports this fault and dialog recorder.
const mode =
  process.argv
    .find((argument) => argument.startsWith('--startup-case='))
    ?.slice(15) ?? 'normal';
const data = process.argv
  .find((argument) => argument.startsWith('--data-dir='))
  ?.slice(11);
if (!data || !['normal', 'hold', 'native-hold', 'fail', 'crash'].includes(mode))
  throw new Error('STARTUP_FIXTURE_ARGUMENTS');
const state = {
  marker: 'startup-fixture',
  mode,
  messages: [] as unknown[],
  quitRequested: false,
};
Object.assign(globalThis, { startupFixture: state });
const nativeMessage = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = (
  _windowOrOptions: unknown,
  possibleOptions?: unknown,
) => {
  const options = possibleOptions ?? _windowOrOptions;
  state.messages.push(options);
  writeFileSync(join(data, 'startup-dialog.json'), JSON.stringify(state));
  return mode === 'native-hold'
    ? nativeMessage(options as Parameters<typeof dialog.showMessageBox>[0])
    : Promise.resolve({ response: 0, checkboxChecked: false });
};
app.on('before-quit', () => {
  state.quitRequested = true;
});
app.on('browser-window-created', (_event, window) => {
  const load = window.loadURL.bind(window);
  window.loadURL = (url, options) => {
    if (url !== APP_URL || mode === 'normal') return load(url, options);
    window.webContents.emit('did-start-loading');
    if (mode === 'fail')
      queueMicrotask(() =>
        window.webContents.emit(
          'did-fail-load',
          {},
          -2,
          'generated failure',
          APP_URL,
          true,
        ),
      );
    if (mode === 'crash')
      queueMicrotask(() =>
        window.webContents.emit(
          'render-process-gone',
          {},
          { reason: 'crashed', exitCode: 1 },
        ),
      );
    return new Promise<void>(() => undefined);
  };
});
