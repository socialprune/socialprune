import { object, VariantSchema } from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { storePhoto } from './media.ts';
import { SyndicationClient } from './syndication.ts';
import {
  chooseVariants,
  downloadMedia,
  mediaURL,
  productionMedia,
  DEFAULT_MEDIA_LIMITS,
} from './video.ts';
import type { MediaBudget, MediaDependencies } from './video.ts';
import { CliError } from '../cli/errors.ts';
export async function storeOriginalMedia(
  workspace: string,
  original: Original,
  client: SyndicationClient,
  budget: MediaBudget,
  signal: AbortSignal,
  deps: MediaDependencies = productionMedia,
): Promise<void> {
  const raw =
    original.textSource === 'signed-in'
      ? original.signedInRecord
      : original.raw;
  const details = object(raw).mediaDetails;
  const posterFor = async (
    entry: Original['media'][number],
    url: string | null,
  ) => {
    if (!url || entry.poster) return;
    if ((await deps.free(workspace)) < DEFAULT_MEDIA_LIMITS.freeBytes)
      throw new CliError('DISK_LOW');
    const delay = budget.lastStart + 1000 - deps.now();
    if (delay > 0) await deps.sleep(delay);
    budget.lastStart = deps.now();
    try {
      const result = await client.photo(url, signal);
      if (
        result.extension === 'gif' ||
        budget.used + result.bytes.length > budget.runBytes
      )
        return;
      const file = `${entry.n}-poster.${result.extension}`;
      await storePhoto(workspace, original.id, file, result.bytes);
      entry.poster = file;
      budget.used += result.bytes.length;
      budget.failures = 0;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CliError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'MEDIA_RATE_LIMIT'
      )
        throw new CliError('MEDIA_RATE_LIMIT');
      budget.failures++;
      if (budget.failures >= 5) throw new CliError('MEDIA_FAILED');
    }
  };
  for (const entry of original.media) {
    if (entry.status === 'not-stored' && entry.url === null) continue;
    const data = Array.isArray(details) ? object(details[entry.n - 1]) : {},
      poster =
        typeof data.media_url_https === 'string' ? data.media_url_https : null;
    if (
      entry.status === 'stored' ||
      entry.status === 'refused' ||
      entry.status === 'hls-only' ||
      entry.status === 'no-variant'
    ) {
      if (entry.kind !== 'photo') await posterFor(entry, poster);
      continue;
    }
    if ((await deps.free(workspace)) < DEFAULT_MEDIA_LIMITS.freeBytes)
      throw new CliError('DISK_LOW');
    if (budget.used >= budget.runBytes) {
      entry.status = 'run-cap';
      continue;
    }
    if (entry.kind === 'photo') {
      if (!entry.url) {
        entry.status = 'failed';
        continue;
      }
      const delay = budget.lastStart + 1000 - deps.now();
      if (delay > 0) await deps.sleep(delay);
      budget.lastStart = deps.now();
      try {
        const result = await client.photo(entry.url, signal);
        if (budget.used + result.bytes.length > budget.runBytes) {
          entry.status = 'run-cap';
          continue;
        }
        const file = `${entry.n}.${result.extension}`;
        await storePhoto(workspace, original.id, file, result.bytes);
        Object.assign(entry, {
          file,
          status: 'stored',
          bytes: result.bytes.length,
        });
        budget.used += result.bytes.length;
        budget.failures = 0;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof CliError) throw error;
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'MEDIA_RATE_LIMIT'
        )
          throw new CliError('MEDIA_RATE_LIMIT');
        entry.status = 'failed';
        budget.failures++;
        if (budget.failures >= 5) throw new CliError('MEDIA_FAILED');
      }
      continue;
    }
    const info = object(data.video_info),
      rawVariants = Array.isArray(info.variants) ? info.variants : [];
    const variants = chooseVariants(
      rawVariants.flatMap((value) => {
        const parsed = VariantSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    );
    if (!variants.length) {
      entry.status = rawVariants.length ? 'hls-only' : 'no-variant';
      await posterFor(entry, poster);
      continue;
    }
    for (const variant of variants) {
      const result = await downloadMedia(
        mediaURL(variant.url, 'video', deps.origin),
        { workspace, id: original.id, n: entry.n },
        budget,
        signal,
        deps,
      );
      Object.assign(entry, {
        status: result.status,
        bytes: result.bytes,
        file: result.status === 'stored' ? `${entry.n}.mp4` : null,
        url: variant.url,
        bitrateLabel: variant.bitrate ?? null,
      });
      if (result.status !== 'too-large') break;
      await import('node:fs/promises').then(async (fs) => {
        const directory = await import('./media.ts').then((value) =>
          value.originalDirectory(workspace, original.id, true),
        );
        await fs
          .unlink(directory + `/${entry.n}.mp4.part`)
          .catch(() => undefined);
      });
    }
    await posterFor(entry, poster);
  }
}
