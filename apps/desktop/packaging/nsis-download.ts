import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { verifyNsisArchive } from './nsis-checks.ts';
import { NSIS_SHA256, NSIS_URLS, NSIS_VERSION } from './nsis-version.ts';
import { dist } from './paths.ts';

export interface NsisRetryReceipt {
  attempt: number;
  urlIndex: number;
  cause: 'timeout' | 'network' | 'http';
  status?: number;
}

const absent = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
const timedOut = (error: unknown) =>
  error instanceof Error &&
  (['TimeoutError', 'AbortError'].includes(error.name) ||
    (error.cause &&
      typeof error.cause === 'object' &&
      'code' in error.cause &&
      [
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
      ].includes(String(error.cause.code))));
async function cached(path: string, expected: string) {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
  // A stale or poisoned cache is never silently repaired from the network.
  verifyNsisArchive(bytes, expected);
  return { path, bytes };
}

/** One archive cache for units, packaging and installed proofs. Tools are separate. */
export async function loadNsisArchive(
  expected = NSIS_SHA256,
  options: {
    cacheDirectory?: string;
    workspace?: string;
    fetch?: typeof fetch;
    urls?: readonly string[];
    timeoutMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
    record?: (receipt: NsisRetryReceipt) => void;
  } = {},
) {
  const directory = options.cacheDirectory ?? dist;
  const archive = join(directory, `nsis-${NSIS_VERSION}.zip`);
  const candidates = new Set([
    archive,
    join(options.workspace ?? directory, `nsis-${NSIS_VERSION}.zip`),
  ]);
  for (const path of candidates) {
    const result = await cached(path, expected);
    if (result) return result;
  }
  const urls = options.urls ?? NSIS_URLS;
  if (!urls.length) throw new Error('NSIS_DOWNLOAD_URL_MISSING');
  await mkdir(directory, { recursive: true });
  const download = options.fetch ?? fetch;
  let bytes: Buffer | undefined;
  let lastFailure: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    // Another process may have populated the verified cache during a retry.
    const result = await cached(archive, expected);
    if (result) return result;
    const urlIndex = (attempt - 1) % urls.length;
    let receipt: NsisRetryReceipt;
    try {
      const response = await download(urls[urlIndex]!, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`NSIS_DOWNLOAD_FAILED:${response.status}`);
        if (![408, 429, 500, 502, 503, 504].includes(response.status))
          throw error;
        lastFailure = error;
        receipt = { attempt, urlIndex, cause: 'http', status: response.status };
      } else {
        bytes = Buffer.from(await response.arrayBuffer());
        break;
      }
    } catch (error) {
      if (
        !(error instanceof TypeError) &&
        !(
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
        )
      )
        throw error;
      lastFailure = error;
      receipt = {
        attempt,
        urlIndex,
        cause: timedOut(error) ? 'timeout' : 'network',
      };
    }
    (
      options.record ??
      ((value) => console.warn('NSIS_DOWNLOAD_RETRY', JSON.stringify(value)))
    )(receipt);
    if (attempt < 4)
      await (options.wait ?? ((milliseconds) => setTimeout(milliseconds)))(
        attempt * 1000,
      );
  }
  if (!bytes)
    throw new Error('NSIS_DOWNLOAD_EXHAUSTED', { cause: lastFailure });
  // Integrity is not a transient mirror fault: never try another URL on mismatch.
  verifyNsisArchive(bytes, expected);
  const temporary = join(directory, `.nsis-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, archive);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
    }
    // Concurrent publication is fine only when the winner has the same digest.
    const result = await cached(archive, expected);
    if (!result) throw new Error('NSIS_CACHE_PUBLICATION_MISSING');
    return result;
  } finally {
    await unlink(temporary);
  }
}
