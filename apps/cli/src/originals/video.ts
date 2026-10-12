import { open, lstat, rename, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { OriginalMedia, Variant } from '@socialprune/core';
import { originalDirectory } from './media.ts';
import { CliError } from '../cli/errors.ts';
import type { ReadableStreamReadResult } from 'node:stream/web';
export const VIDEO_ORIGIN = 'https://video.twimg.com';
export const PHOTO_ORIGIN = 'https://pbs.twimg.com';
export const DEFAULT_MEDIA_LIMITS = Object.freeze({
  videoBytes: 1024 ** 3,
  runBytes: 20 * 1024 ** 3,
  freeBytes: 5 * 1024 ** 3,
});
export interface MediaBudget {
  videoBytes: number;
  runBytes: number;
  used: number;
  lastStart: number;
  failures: number;
}
export function chooseVariants(variants: Variant[]): Variant[] {
  return variants
    .filter((value) => value.content_type === 'video/mp4')
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
}
export function mediaURL(
  value: string,
  kind: 'photo' | 'video',
  testOrigin?: string,
): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.port && url.origin !== testOrigin) ||
    url.hash ||
    !(testOrigin
      ? url.origin === testOrigin
      : url.origin === (kind === 'video' ? VIDEO_ORIGIN : PHOTO_ORIGIN))
  )
    throw new Error('MEDIA_ORIGIN');
  return url;
}
export interface MediaDependencies {
  origin?: string;
  free(workspace: string): Promise<number>;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  headerMs: number;
  idleMs: number;
}
export const productionMedia: MediaDependencies = {
  async free(workspace) {
    const value = await statfs(workspace);
    return Number(value.bavail) * Number(value.bsize);
  },
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: async (ms) => {
    await sleep(ms);
  },
  headerMs: 15000,
  idleMs: 30000,
};
export async function downloadMedia(
  url: URL,
  target: { workspace: string; id: string; n: number },
  budget: MediaBudget,
  signal: AbortSignal,
  deps: MediaDependencies = productionMedia,
): Promise<{ status: OriginalMedia['status']; bytes: number | null }> {
  mediaURL(url.href, 'video', deps.origin);
  if ((await deps.free(target.workspace)) < DEFAULT_MEDIA_LIMITS.freeBytes)
    throw new CliError('DISK_LOW');
  if (budget.used >= budget.runBytes) return { status: 'run-cap', bytes: null };
  const delay = budget.lastStart + 1000 - deps.now();
  if (delay > 0) await deps.sleep(delay);
  budget.lastStart = deps.now();
  const controller = new AbortController();
  const failed = () => {
    budget.failures++;
    if (budget.failures >= 5) throw new CliError('MEDIA_FAILED');
    return { status: 'failed' as const, bytes: null };
  };
  const timeout = setTimeout(() => controller.abort(), deps.headerMs);
  let response: Response;
  try {
    response = await deps.fetch(url, {
      signal: AbortSignal.any([signal, controller.signal]),
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'User-Agent': 'SocialPrune/0.0.0' },
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CliError) throw error;
    return failed();
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new CliError('MEDIA_RATE_LIMIT');
  }
  if (response.status === 403) {
    await response.body?.cancel();
    return { status: 'refused', bytes: null };
  }
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0] !== 'video/mp4' ||
    !response.body
  ) {
    await response.body?.cancel();
    return failed();
  }
  const known = response.headers.has('content-length'),
    declared = known
      ? Number(response.headers.get('content-length'))
      : Infinity;
  if (known && (!Number.isSafeInteger(declared) || declared < 8)) {
    await response.body.cancel();
    return failed();
  }
  if (known && declared > budget.videoBytes) {
    await response.body.cancel();
    return { status: 'too-large', bytes: null };
  }
  if (known && budget.used + declared > budget.runBytes) {
    await response.body.cancel();
    return { status: 'run-cap', bytes: null };
  }
  const directory = await originalDirectory(target.workspace, target.id, true),
    file = `${target.n}.mp4`,
    path = join(directory, file),
    partial = path + '.part';
  const existing = await lstat(path).catch(() => null);
  if (existing) {
    await response.body.cancel();
    if (existing.isSymbolicLink() || !existing.isFile())
      throw new Error('ORIGINAL_PATH');
    const present = await open(path, 'r');
    try {
      const header = Buffer.alloc(12);
      await present.read(header, 0, 12, 0);
      if (
        existing.size < 8 ||
        header.subarray(4, 8).toString('ascii') !== 'ftyp'
      )
        throw new Error('MEDIA_FORMAT');
      return { status: 'stored', bytes: existing.size };
    } finally {
      await present.close();
    }
  }
  const handle = await open(partial, 'wx'),
    reader = response.body.getReader();
  let count = 0,
    head = Buffer.alloc(0),
    valid = false;
  try {
    for (;;) {
      const idle = setTimeout(() => controller.abort(), deps.idleMs);
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } finally {
        clearTimeout(idle);
      }
      if (next.done) break;
      count += next.value.length;
      if (count > declared) throw new Error('MEDIA_FORMAT');
      if (count > budget.videoBytes) throw new Error('MEDIA_TOO_LARGE');
      if (next.value.length + budget.used > budget.runBytes)
        throw new Error('MEDIA_RUN_CAP');
      if (head.length < 12)
        head = Buffer.concat([head, Buffer.from(next.value)]).subarray(0, 12);
      await handle.writeFile(next.value);
      budget.used += next.value.length;
    }
    if (
      (known && count !== declared) ||
      head.subarray(4, 8).toString('ascii') !== 'ftyp'
    )
      throw new Error('MEDIA_FORMAT');
    await handle.sync();
    valid = true;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.message === 'MEDIA_TOO_LARGE')
      return { status: 'too-large', bytes: null };
    if (error instanceof Error && error.message === 'MEDIA_RUN_CAP')
      return { status: 'run-cap', bytes: null };
    budget.failures++;
    if (budget.failures >= 5) throw new CliError('MEDIA_FAILED');
    return { status: 'failed', bytes: null };
  } finally {
    await handle.close();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (valid) {
    await rename(partial, path);
    budget.failures = 0;
    return { status: 'stored', bytes: count };
  }
  return { status: 'failed', bytes: null };
}
