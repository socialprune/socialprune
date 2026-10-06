export interface Variant {
  id: string;
  platform: 'x' | 'instagram';
  description: string;
  files: Readonly<Record<string, string | Uint8Array>>;
  expected: unknown;
}

export interface LargeOptions {
  out: string;
  count: number;
  seed: number;
}

export { createRandom } from './random.ts';
