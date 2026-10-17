import { resolve } from 'node:path';

export const directory = resolve(import.meta.dirname, '..');
export const root = resolve(directory, '../..');
export const dist = resolve(directory, 'dist');
export const ELECTRON_VERSION = '44.8.0';
export const ARCHIVE_NAME = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
export const executable = (variant: 'release' | 'test' | 'probe') =>
  resolve(dist, variant, 'SocialPrune.exe');
