import { join } from 'node:path';
import { app, session } from 'electron';
import { startDesktop } from '../../src/main/app.ts';

const dataDirectory = process.argv
  .find((argument) => argument.startsWith('--data-dir='))
  ?.slice(11);
if (!dataDirectory) throw new Error('TEST_DATA_DIRECTORY_REQUIRED');
const requests: string[] = [];
// Session observation is attached before startDesktop creates the window.
void app.whenReady().then(() => {
  const local = session.fromPartition('socialprune');
  local.webRequest.onCompleted((details) => {
    requests.push(details.url);
  });
  local.webRequest.onErrorOccurred((details) => {
    requests.push(details.url);
  });
});
void startDesktop({
  dataDirectory,
  assets: join(import.meta.dirname, 'renderer'),
  preload: join(import.meta.dirname, 'preload.cjs'),
  engine: join(import.meta.dirname, 'engine.cjs'),
}).then((state) =>
  Object.assign(globalThis, { desktopProbe: { ...state, requests } }),
);
