import { isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';
import { startDesktop } from './app.ts';

// A named local data folder is also used by the packaged smoke. It selects no
// test code, browser, host, or mutation; the production graph is unchanged.
const selected = process.argv
  .find((argument) => argument.startsWith('--data-dir='))
  ?.slice(11);
if (selected && !isAbsolute(selected))
  throw new Error('DATA_DIRECTORY_INVALID');
const dataDirectory =
  selected ?? resolve(app.getPath('appData'), '../Local/SocialPrune Data');
void startDesktop({
  dataDirectory,
  assets: join(import.meta.dirname, 'renderer'),
  preload: join(import.meta.dirname, 'preload.cjs'),
  engine: join(import.meta.dirname, 'engine.cjs'),
}).catch(() => {
  console.error('DESKTOP_START_FAILED');
  app.exit(1);
});
