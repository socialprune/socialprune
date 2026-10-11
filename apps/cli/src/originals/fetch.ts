import { setTimeout } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { OriginalIdSchema } from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { workspacePath } from '../workspace/files.ts';
import type { WorkspaceCall } from '../workspace/services.ts';
import { SyndicationClient } from './syndication.ts';
import { storePhoto } from './media.ts';
import { CliError } from '../cli/errors.ts';

export interface OriginalsCall extends WorkspaceCall {
  account?: string;
  limit?: number;
  progress?: (text: string) => void;
}
export async function fetchOriginals(
  input: OriginalsCall,
  options: { baseUrl?: string } = {},
) {
  input.signal.throwIfAborted();
  if (
    input.limit !== undefined &&
    (!Number.isSafeInteger(input.limit) || input.limit < 1)
  )
    throw new CliError('INVALID_ARGUMENTS');
  const target = await workspacePath(input.workspace, false);
  const source = await SQLiteStore.open(target.path, { readOnly: true });
  const plan = await source
    .read(async (tx) => {
      const ids = new Set<string>();
      const complete = new Set<string>();
      const accounts = new Set<string>();
      for await (const record of tx.imports.iterate())
        if (record.status === 'complete') complete.add(record.id);
      for await (const { item, importId } of tx.items.iterate()) {
        if (item.platform !== 'x' || (importId && !complete.has(importId)))
          continue;
        accounts.add(item.account.key);
        if (input.account !== undefined && item.account.key !== input.account)
          continue;
        for (const id of [item.reference.replyToId, item.reference.quotedId])
          if (OriginalIdSchema.safeParse(id).success) ids.add(id!);
      }
      if (input.account !== undefined && !accounts.has(input.account))
        throw new CliError('INVALID_ARGUMENTS');
      const pending: string[] = [];
      let stored = 0;
      for (const id of ids) {
        if (await tx.originals.get(id)) stored++;
        else pending.push(id);
      }
      return {
        referenced: ids.size,
        stored,
        ids: pending.slice(0, input.limit),
        pending: pending.length,
      };
    })
    .finally(() => source.close());
  input.progress?.(
    `${plan.referenced} referenced originals; ${plan.stored} already stored; ${plan.ids.length} to fetch.`,
  );
  const data = {
    dryRun: Boolean(input.dryRun),
    referenced: plan.referenced,
    stored: plan.stored,
    planned: plan.ids.length,
    attempted: 0,
    fetched: 0,
    notFound: 0,
    tombstone: 0,
    failed: 0,
    photosStored: 0,
    photosFailed: 0,
    videosNotStored: 0,
    remaining: plan.pending,
    stoppedAfterFailures: false,
  };
  if (input.dryRun || !plan.ids.length) return { data };
  input.progress?.(
    "This command sends the referenced post IDs to X's anonymous syndication host and downloads photos. It uses no login or API key. Long-post text may be incomplete; videos are not stored.",
  );
  const client = new SyndicationClient(options);
  const store = await SQLiteStore.open(target.path);
  let previousStart: number | undefined;
  let consecutiveFailures = 0;
  try {
    for (const id of plan.ids) {
      input.signal.throwIfAborted();
      if (await store.read((tx) => tx.originals.get(id))) {
        data.stored++;
        data.remaining--;
        continue;
      }
      if (previousStart !== undefined) {
        const delay = 1000 - (performance.now() - previousStart);
        if (delay > 0)
          await setTimeout(Math.ceil(delay), undefined, {
            signal: input.signal,
          });
      }
      const fetchedAt = input.now().toISOString();
      let original: Original;
      try {
        original = await client.fetchOriginal(id, fetchedAt, input.signal);
      } catch {
        input.signal.throwIfAborted();
        original = {
          id,
          status: 'failed',
          fetchedAt,
          text: null,
          authorName: null,
          authorHandle: null,
          photos: [],
          quotedId: null,
          parentId: null,
          raw: { error: 'SYNDICATION_FAILED' },
          textCompleteness: 'unknown',
          video: null,
        };
      }
      let photoFailure = false;
      for (const [index, photo] of original.photos.entries()) {
        try {
          const result = await client.photo(photo.url, input.signal);
          const file = `${index + 1}.${result.extension}`;
          await storePhoto(input.workspace, id, file, result.bytes);
          original.photos[index] = { ...photo, file, status: 'stored' };
          data.photosStored++;
        } catch {
          input.signal.throwIfAborted();
          photoFailure = true;
          data.photosFailed++;
        }
      }
      await store.write(async (tx) => {
        await tx.originals.put(original);
        const meta = await tx.meta.get();
        const runtime = await tx.runtime.get();
        await tx.meta.set({ ...meta, updatedAt: fetchedAt });
        await tx.runtime.set({ revision: runtime.revision + 1 });
      });
      data.attempted++;
      data.remaining--;
      if (original.status === 'not-found') data.notFound++;
      else if (original.status === 'tombstone') data.tombstone++;
      else if (original.status === 'fetched') data.fetched++;
      else data.failed++;
      if (original.video) data.videosNotStored++;
      input.progress?.(
        `${data.attempted}/${data.planned} originals recorded; ${data.failed} failed.`,
      );
      consecutiveFailures =
        original.status === 'failed' || photoFailure
          ? consecutiveFailures + 1
          : 0;
      if (consecutiveFailures >= 5) {
        data.stoppedAfterFailures = true;
        break;
      }
      // Space completed requests, not merely fetch() calls: connection setup
      // can otherwise make the fake/remote server see arrivals less than 1 s apart.
      previousStart = performance.now();
    }
    return { data };
  } finally {
    await store.close();
  }
}
