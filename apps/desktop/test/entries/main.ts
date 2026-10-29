import { join } from 'node:path';
import { app, session } from 'electron';
import { startDesktop } from '../../src/main/app.ts';
import '../quiet-windows.ts';
import type { EngineFileSelection } from 'socialprune/engine';
import { displayControl } from '../display-control.ts';

const dataDirectory = process.argv
  .find((argument) => argument.startsWith('--data-dir='))
  ?.slice(11);
if (!dataDirectory) throw new Error('TEST_DATA_DIRECTORY_REQUIRED');
const displayProducer = dataDirectory.endsWith('display-producer');
const requests: string[] = [];
const selections: EngineFileSelection[] = [];
const links: string[] = [];
const dialogLocales: string[] = [];
const platformWindow: {
  value: {
    id: string;
    bounds: { x: number; y: number; width: number; height: number };
  } | null;
  moves: unknown[];
} = { value: null, moves: [] };
const removalReports: unknown[] = [];
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
  ...(displayProducer
    ? {}
    : {
        platformWindow: {
          current: () => Promise.resolve(platformWindow.value),
          move(id, bounds, flags) {
            platformWindow.moves.push({ id, bounds, flags });
            if (platformWindow.value?.id === id)
              platformWindow.value = { id, bounds };
            return Promise.resolve();
          },
        },
      }),
  removalReport(result) {
    removalReports.push(result);
    return Promise.resolve();
  },
  dialogs: {
    select: (_window, type, locale) => {
      dialogLocales.push(locale);
      return Promise.resolve(
        selections.shift() ??
          (type === 'importExport'
            ? { type, paths: null }
            : { type, path: null }),
      );
    },
  },
  links: {
    external: (url) => {
      links.push(url);
      return Promise.resolve();
    },
    folder: (path) => {
      links.push(path);
      return Promise.resolve('');
    },
  },
}).then((state) =>
  Object.assign(globalThis, {
    desktopProbe: {
      ...state,
      requests,
      selections,
      links,
      dialogLocales,
      platformWindow,
      removalReports,
      displayControl: (command: Parameters<typeof displayControl>[1]) =>
        displayControl(state!.engine.child, command),
    },
  }),
);
