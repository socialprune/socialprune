import { setTimeout } from 'node:timers/promises';
import { OriginalIdSchema, migrateOriginal } from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { workspacePath } from '../workspace/files.ts';
import type { WorkspaceCall } from '../workspace/services.ts';
import { SyndicationClient } from './syndication.ts';
import { cleanupParts } from './media.ts';
import { CliError } from '../cli/errors.ts';
import { storeOriginalMedia } from './store-media.ts';
import { DEFAULT_MEDIA_LIMITS, productionMedia } from './video.ts';
import type { MediaDependencies } from './video.ts';
export interface OriginalsCall extends WorkspaceCall {
  account?: string;
  limit?: number;
  progress?: (text: string) => void;
}
export async function fetchOriginals(
  input: OriginalsCall,
  options: { baseUrl?: string; media?: MediaDependencies } = {},
) {
  input.signal.throwIfAborted();
  if (
    input.limit !== undefined &&
    (!Number.isSafeInteger(input.limit) || input.limit < 1)
  )
    throw new CliError('INVALID_ARGUMENTS');
  const target = await workspacePath(input.workspace, false),
    source = await SQLiteStore.open(target.path, { readOnly: true });
  const plan = await source
    .read(async (tx) => {
      const references = new Set<string>(),
        own = new Map<string, string | null>(),
        complete = new Set<string>(),
        records = new Map<string, Original>(),
        accounts = new Set<string>();
      for await (const record of tx.imports.iterate())
        if (record.status === 'complete') complete.add(record.id);
      for await (const { item, importId } of tx.items.iterate())
        if (item.platform === 'x' && complete.has(importId)) {
          accounts.add(item.account.key);
          if (input.account && item.account.key !== input.account) continue;
          own.set(item.id.slice(2), item.reference.replyToId);
          for (const id of [item.reference.replyToId, item.reference.quotedId])
            if (OriginalIdSchema.safeParse(id).success) references.add(id!);
        }
      if (input.account && !accounts.has(input.account))
        throw new CliError('INVALID_ARGUMENTS');
      for await (const record of tx.originals.iterate())
        records.set(record.id, migrateOriginal(record));
      const queue: { id: string; depth: number; quoted: boolean }[] = [
          ...references,
        ].map((id) => ({ id, depth: 0, quoted: false })),
        seen = new Set<string>(),
        ids: string[] = [];
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i]!;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        if (own.has(node.id)) {
          const parent = own.get(node.id);
          if (parent && node.depth < 20)
            queue.push({
              id: parent,
              depth: node.depth + 1,
              quoted: node.quoted,
            });
          continue;
        }
        ids.push(node.id);
        const record = records.get(node.id);
        if (record?.parentId && node.depth < 20)
          queue.push({
            id: record.parentId,
            depth: node.depth + 1,
            quoted: node.quoted,
          });
        if (record?.quotedId && !node.quoted)
          queue.push({ id: record.quotedId, depth: 0, quoted: true });
      }
      const requested = ids.filter(
        (id) =>
          !records.has(id) ||
          (records.get(id)!.signedIn === null &&
            records.get(id)!.anonymous?.status === 'failed'),
      );
      return { references, own, records, ids, requested, queue };
    })
    .finally(() => source.close());
  const data = {
    dryRun: Boolean(input.dryRun),
    referenced: plan.references.size,
    stored: plan.ids.filter((id) => plan.records.has(id)).length,
    planned: Math.min(plan.requested.length, input.limit ?? Infinity),
    attempted: 0,
    fetched: 0,
    notFound: 0,
    tombstone: 0,
    failed: 0,
    photosStored: 0,
    photosFailed: 0,
    videosNotStored: 0,
    videosPlanned: plan.ids
      .flatMap((id) => plan.records.get(id) ?? [])
      .filter((record) => record.signedIn === null)
      .reduce(
        (sum, record) =>
          sum +
          record.media.filter(
            (media) =>
              media.kind !== 'photo' &&
              media.url !== null &&
              media.status !== 'stored' &&
              media.status !== 'refused',
          ).length,
        0,
      ),
    videosStored: 0,
    remaining: plan.requested.length,
    stoppedAfterFailures: false,
  };
  input.progress?.(
    `${data.referenced} referenced originals; ${data.stored} already stored; ${data.planned} to fetch.`,
  );
  if (input.dryRun) return { data };
  await cleanupParts(input.workspace);
  const store = await SQLiteStore.open(target.path),
    client = new SyndicationClient(options),
    deps = options.media ?? productionMedia,
    budget = {
      videoBytes: DEFAULT_MEDIA_LIMITS.videoBytes,
      runBytes: DEFAULT_MEDIA_LIMITS.runBytes,
      used: 0,
      lastStart: 0,
      failures: 0,
    };
  let failures = 0,
    last = 0;
  const queue = [...plan.queue],
    seen = new Set<string>();
  input.progress?.(
    'This command sends referenced, parent and quoted post IDs to the anonymous X embed host and downloads their media without sign-in. Long-post text may still be incomplete.',
  );
  try {
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i]!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (plan.own.has(node.id)) {
        const parent = plan.own.get(node.id);
        if (parent && node.depth < 20)
          queue.push({
            id: parent,
            depth: node.depth + 1,
            quoted: node.quoted,
          });
        continue;
      }
      let original = await store.read((tx) => tx.originals.get(node.id));
      if (
        !original ||
        (original.signedIn === null && original.anonymous?.status === 'failed')
      ) {
        if (input.limit && data.attempted >= input.limit) continue;
        const delay = last + 1000 - Date.now();
        if (delay > 0)
          await setTimeout(delay, undefined, { signal: input.signal });
        try {
          original = await client.fetchOriginal(
            node.id,
            input.now().toISOString(),
            input.signal,
          );
        } catch {
          input.signal.throwIfAborted();
          original = migrateOriginal({
            id: node.id,
            status: 'failed',
            fetchedAt: input.now().toISOString(),
            text: null,
            authorName: null,
            authorHandle: null,
            photos: [],
            quotedId: null,
            parentId: null,
            raw: { error: 'SYNDICATION_FAILED' },
            textCompleteness: 'unknown',
            video: null,
          });
        }
        last = Date.now();
        data.attempted++;
        if (original.anonymous?.status === 'fetched') data.fetched++;
        else if (original.anonymous?.status === 'not-found') data.notFound++;
        else if (original.anonymous?.status === 'tombstone') data.tombstone++;
        else data.failed++;
      }
      if (!original) continue;
      let mediaFailure: unknown;
      // Anonymous retries cannot replace or edit any signed-in result.
      if (original.signedIn === null) {
        try {
          await storeOriginalMedia(
            input.workspace,
            original,
            client,
            budget,
            input.signal,
            deps,
          );
        } catch (caught) {
          mediaFailure = caught;
        }
        await store.write(async (tx) => {
          await tx.originals.put(original);
          const meta = await tx.meta.get(),
            runtime = await tx.runtime.get();
          await tx.meta.set({
            ...meta,
            schemaVersion: 4,
            updatedAt: input.now().toISOString(),
          });
          await tx.runtime.set({ revision: runtime.revision + 1 });
        });
      }
      data.photosStored += original.media.filter(
        (media) => media.kind === 'photo' && media.status === 'stored',
      ).length;
      data.photosFailed += original.media.filter(
        (media) => media.kind === 'photo' && media.status === 'failed',
      ).length;
      data.videosStored += original.media.filter(
        (media) => media.kind !== 'photo' && media.status === 'stored',
      ).length;
      data.videosNotStored += original.media.filter(
        (media) => media.kind !== 'photo' && media.status !== 'stored',
      ).length;
      if (mediaFailure)
        throw mediaFailure instanceof Error
          ? mediaFailure
          : new CliError('MEDIA_FAILED');
      failures =
        original.signedIn === null && original.anonymous?.status === 'failed'
          ? failures + 1
          : 0;
      if (failures >= 5) {
        data.stoppedAfterFailures = true;
        break;
      }
      if (original.parentId && node.depth < 20)
        queue.push({
          id: original.parentId,
          depth: node.depth + 1,
          quoted: node.quoted,
        });
      if (original.quotedId && !node.quoted)
        queue.push({ id: original.quotedId, depth: 0, quoted: true });
      if (
        budget.used >= budget.runBytes ||
        (original.signedIn === null &&
          original.media.some((media) => media.status === 'run-cap'))
      )
        break;
    }
    data.remaining = Math.max(0, data.remaining - data.attempted);
    return { data };
  } finally {
    await store.close();
  }
}
