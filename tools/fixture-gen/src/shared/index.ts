export interface Variant {
  id: string;
  platform: string;
  description: string;
  archives: Array<{ name: string; files: Record<string, string | Uint8Array> }>;
  expected: unknown;
}

export interface LargeOptions {
  out: string;
  count: number;
  seed: number;
  zip64?: boolean;
}

export { createRandom } from './random.ts';
export { writeZipFile, FIXTURE_DATE } from './zip.ts';
export type { ZipFileEntry } from './zip.ts';
