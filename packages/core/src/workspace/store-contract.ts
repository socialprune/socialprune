import {
  WORKSPACE_SCHEMA_VERSION,
  validateInstagramContexts,
} from '../model/index.ts';
import type {
  DecisionEvent,
  Item,
  WorkspaceV2,
  InstagramContext,
} from '../model/index.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import type { WorkspaceStore, WriteTransaction } from './store.ts';
import { canonicalJson } from './canonical.ts';
import { JOURNAL_FIXTURE } from '../model/browser-fixture.ts';
import { createBackup, restoreBackup } from './backup.ts';
import { OriginalsFillWriter } from './originals-fill-writer.ts';
import { migrateOriginal } from '../model/original.ts';
import { InstagramContextWriter } from './instagram-context-writer.ts';

/** Generated inputs mirroring fixtures/synthetic/instagram/current-minimal. */
export function instagramContractItem(): Item {
  return {
    ...contractWorkspace().items[0]!,
    id: 'instagram:9458b31a368a29d3fa3f30154ee2624755d336f186853d35a5ea3baf15b9fef4',
    platform: 'instagram',
    account: { key: 'instagram:synth_fern', handle: 'synth_fern' },
    kind: 'comment',
    text: 'Invented fern photo comment.',
    createdAt: '2025-07-31T00:00:00.000Z',
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: 'synth_moss',
    },
  };
}
export function instagramContractRecord(
  item: Item = instagramContractItem(),
): Extract<InstagramContext, { confirmedBy: 'post' }> & {
  ownerCheck: 'matched-export';
} {
  return {
    itemId: item.id,
    accountKey: item.account.key,
    confirmedBy: 'post',
    ownerCheck: 'matched-export',
    post: {
      kind: 'p',
      code: 'Generated_Aa-1',
      owner: 'synth_moss',
      ownerCount: 1,
      createdAt: '2025-07-30T00:00:00.000Z',
      caption: 'Generated fern caption.',
      captionComplete: true,
    },
    comment: {
      id: '910001',
      createdAt: '2025-07-31T00:00:00.000Z',
      expandClicks: 1,
    },
    image: {
      file: 'image.jpg',
      host: 'generated.cdninstagram.com',
      status: 'stored',
    },
    screenshot: { file: 'shot.jpg', bytes: 3, status: 'stored' },
    confirmedAt: '2026-10-15T00:00:00.000Z',
    runId: 'generated-context',
    attemptId: 'generated-confirm-send',
  };
}

export async function writeInstagramContextContract(
  store: WorkspaceStore,
  item: Item = instagramContractItem(),
  confirmedAt?: string,
): Promise<
  Extract<InstagramContext, { confirmedBy: 'post' }> & {
    ownerCheck: 'matched-export';
  }
> {
  const record = {
      ...instagramContractRecord(item),
      ...(confirmedAt ? { confirmedAt } : {}),
    },
    writer = new InstagramContextWriter(store),
    at = record.confirmedAt;
  await store.write(async (tx) => {
    if (!(await tx.items.get(item.id)))
      await tx.items.put({ item, importId: '', metadataImportId: '' });
  });
  await writer.startRun({
    runId: record.runId,
    accountKey: item.account.key,
    planHash: 'c'.repeat(64),
    startedAt: at,
    canary: true,
  });
  await writer.sending({
    attemptId: record.attemptId,
    runId: record.runId,
    itemId: item.id,
    at,
  });
  await writer.step(record.runId, at);
  await writer.confirm(record);
  await writer.endRun({
    runId: record.runId,
    endedAt: at,
    endReason: 'canary',
    bodyShapes: {},
    profileReport: {
      accountBefore: item.account.handle,
      accountAfter: item.account.handle,
      extensionsBefore: 0,
      extensionsAfter: 0,
      changedFiles: [],
      unexpectedRequests: [
        {
          requestId: 'generated-query',
          method: 'POST',
          host: 'www.instagram.com',
          path: '/async/wbloks/fetch/',
          status: 200,
          operation: 'GeneratedQuery',
        },
      ],
    },
  });
  await writer.acceptCanary(record.runId, at);
  return record;
}

export interface StoreContractHarness {
  store: WorkspaceStore;
  /** Close the old handle and return a new one backed by the same data. */
  reopen(): Promise<WorkspaceStore>;
  /** Dispose only the factory's disposable test workspace. */
  dispose(): Promise<void>;
}
export type StoreContractFactory = (
  initial: WorkspaceV2,
) => Promise<StoreContractHarness>;
export interface StoreContractCheck {
  name: string;
  run(factory: StoreContractFactory): Promise<void>;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Store contract: ${message}`);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(canonicalJson(actual) === canonicalJson(expected), message);
}
async function rejects(operation: () => Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await operation();
  } catch {
    failed = true;
  }
  assert(failed, 'expected rejection');
}
export function contractWorkspace(): WorkspaceV2 {
  const workspace = createWorkspace({
    id: 'contract-workspace',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  const item: Item = {
    id: 'x:1',
    platform: 'x',
    account: { key: 'x:contract', handle: null },
    kind: 'post',
    text: 'Generated contract input.',
    createdAt: workspace.createdAt,
    mediaCount: null,
    engagement: { likes: null, reposts: null },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: null,
    provenance: { archive: 'contract', file: 'posts.json', index: 0 },
  };
  workspace.items.push(item);
  workspace.counts.items = 1;
  return workspace;
}
function contractEvent(
  id: string,
  previous: DecisionEvent['previous'],
  value: DecisionEvent['value'],
): DecisionEvent {
  return {
    eventId: id,
    seq: id === 'page-second' || id === 'second' ? 2 : id === 'third' ? 3 : 1,
    itemId: 'x:1',
    previous,
    value,
    decidedAt: '2026-01-02T00:00:00.000Z',
    source: { kind: 'human', via: 'web-review' },
    action: { id, kind: 'single', size: 1, reverts: null },
  };
}
async function withStore(
  factory: StoreContractFactory,
  operation: (harness: StoreContractHarness) => Promise<void>,
): Promise<void> {
  const harness = await factory(contractWorkspace());
  try {
    await operation(harness);
  } finally {
    await harness.dispose();
  }
}
export const STORE_CONTRACT_CHECKS: readonly StoreContractCheck[] = [
  {
    name: 'Instagram likes supplement is fill-once, confirmation-preserving and transactional',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const prior = await writeInstagramContextContract(harness.store);
        const next = { ...prior, likes: { count: 17, source: 'dom' as const } };
        await rejects(() =>
          harness.store.write(async (tx) => {
            await tx.instagramContext.fillLikes(next);
            throw new Error('Generated likes rollback');
          }),
        );
        equal(
          await harness.store.read((tx) =>
            tx.instagramContext.get(prior.itemId),
          ),
          prior,
          'likes rollback changed confirmation',
        );
        await rejects(() =>
          harness.store.write((tx) =>
            tx.instagramContext.fillLikes({
              ...next,
              post: { ...next.post, code: 'Changed' },
            }),
          ),
        );
        await harness.store.write((tx) => tx.instagramContext.fillLikes(next));
        await rejects(() =>
          harness.store.write((tx) => tx.instagramContext.fillLikes(next)),
        );
        harness.store = await harness.reopen();
        equal(
          await harness.store.read((tx) =>
            tx.instagramContext.get(prior.itemId),
          ),
          next,
          'likes supplement lost on reopen',
        );
      }),
  },
  {
    name: 'Instagram context writer confirms atomically, preserves decisions and retains records through reopen and backup',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const before = await harness.store.read(readWorkspace);
        const record = await writeInstagramContextContract(harness.store);
        const beforeFailure = await harness.store.read(readWorkspace);
        const nextItem = {
          ...instagramContractItem(),
          id: `${record.itemId}2`,
        };
        await harness.store.write((tx) =>
          tx.items.put({ item: nextItem, importId: '', metadataImportId: '' }),
        );
        const faultStore: WorkspaceStore = {
          read: (operation) => harness.store.read(operation),
          write: (operation) =>
            harness.store.write((tx) =>
              operation({
                ...tx,
                instagramContext: {
                  ...tx.instagramContext,
                  add: () =>
                    Promise.reject(
                      new Error('GENERATED_CONTEXT_INSERT_FAILURE'),
                    ),
                },
              }),
            ),
          close: () => Promise.resolve(),
        };
        const faultWriter = new InstagramContextWriter(faultStore);
        await faultWriter.startRun({
          runId: 'generated-context-rollback',
          accountKey: record.accountKey,
          startedAt: record.confirmedAt,
          planHash: 'd'.repeat(64),
        });
        await faultWriter.sending({
          runId: 'generated-context-rollback',
          attemptId: 'generated-context-rollback-send',
          itemId: nextItem.id,
          at: record.confirmedAt,
        });
        const beforeConfirm = await harness.store.read(readWorkspace);
        await rejects(() =>
          faultWriter.confirm({
            ...record,
            itemId: nextItem.id,
            runId: 'generated-context-rollback',
            attemptId: 'generated-context-rollback-send',
            comment: { ...record.comment, id: '910002' },
          }),
        );
        equal(
          await harness.store.read(readWorkspace),
          beforeConfirm,
          'context failure did not roll back confirmed settlement',
        );
        await faultWriter.settle({
          attemptId: 'generated-context-rollback-send',
          state: 'failed',
          at: record.confirmedAt,
          code: 'GENERATED_CONTEXT_INSERT_FAILURE',
        });
        await faultWriter.endRun({
          runId: 'generated-context-rollback',
          endedAt: record.confirmedAt,
          endReason: 'error',
          bodyShapes: {},
          profileReport: {
            accountBefore: nextItem.account.handle,
            accountAfter: nextItem.account.handle,
            extensionsBefore: 0,
            extensionsAfter: 0,
            changedFiles: [],
            unexpectedRequests: [],
          },
        });
        equal(
          (await harness.store.read(readWorkspace)).decisionEvents,
          beforeFailure.decisionEvents,
          'failed confirmation changed decisions',
        );
        const reopened = await harness.reopen();
        const source = await reopened.read(readWorkspace);
        equal(source.instagramContext, [record], 'context lost after reopen');
        equal(
          source.decisionEvents,
          before.decisionEvents,
          'context changed decisions',
        );
        equal(
          source.outcomeEvents,
          before.outcomeEvents,
          'context changed outcomes',
        );
        validateInstagramContexts(
          source.instagramContext!,
          new Map(source.items.map((item) => [item.id, item])),
          source.browserRuns!,
          source.browserAttempts!,
        );
        await rejects(() =>
          reopened.write((tx) => tx.instagramContext.add(record)),
        );
        const target = await factory(createWorkspace());
        try {
          await restoreBackup(target.store, createBackup(reopened).chunks, {
            batchSize: 1,
          });
          equal(
            (await target.store.read(readWorkspace)).instagramContext,
            [record],
            'backup lost context',
          );
        } finally {
          await target.dispose();
        }
      }),
  },
  {
    name: 'v4 signed-in fill and deletion journal coexist and survive portable backup with a failed media record',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const at = '2026-01-02T00:00:00.000Z',
          original = migrateOriginal({
            id: '910',
            status: 'fetched',
            fetchedAt: at,
            text: 'Generated beginning',
            authorName: 'Generated',
            authorHandle: 'generated',
            photos: [],
            quotedId: null,
            parentId: null,
            raw: { note_tweet: {} },
            textCompleteness: 'truncated',
            video: null,
          });
        await harness.store.write(async (tx) => {
          await tx.originals.put(original);
        });
        const writer = new OriginalsFillWriter(harness.store);
        await writer.startRun({
          runId: 'generated-fill',
          accountKey: 'x:contract',
          planHash: 'b'.repeat(64),
          canary: true,
          startedAt: at,
        });
        await writer.sending({
          attemptId: 'generated-fill-send',
          runId: 'generated-fill',
          originalId: '910',
          at,
        });
        const record = {
          ...original,
          text: 'Generated full text',
          textSource: 'signed-in' as const,
          textCompleteness: 'full' as const,
          signedInRecord: { rest_id: '910', text: 'Generated full text' },
          signedIn: {
            status: 'read' as const,
            at,
            runId: 'generated-fill',
            attemptId: 'generated-fill-send',
            reason: null,
          },
          media: [
            {
              n: 1,
              kind: 'video' as const,
              source: 'signed-in' as const,
              url: 'https://video.twimg.com/generated.mp4',
              file: null,
              poster: null,
              status: 'failed' as const,
              bytes: null,
              durationMs: 1000,
              bitrateLabel: 832000,
              altText: null,
            },
          ],
        };
        await writer.settle(
          { attemptId: 'generated-fill-send', state: 'read', at, code: null },
          [record],
        );
        await writer.endRun({
          runId: 'generated-fill',
          endedAt: at,
          endReason: 'canary',
          bodyShapes: { 'read-post': ['generated-shape'] },
          profileReport: {
            accountBefore: 'generated',
            accountAfter: 'generated',
            extensionsBefore: 0,
            extensionsAfter: 0,
            changedFiles: [],
            unexpectedRequests: [],
          },
        });
        await writer.acceptCanary('generated-fill', at);
        await harness.store.write(async (tx) => {
          await tx.browserRuns.add({
            ...JOURNAL_FIXTURE.run,
            runId: 'generated-delete',
          });
          for (const attempt of JOURNAL_FIXTURE.attempts)
            await tx.browserAttempts.add({
              ...attempt,
              runId: 'generated-delete',
              seq: attempt.seq + 2,
            });
        });
        const source = await harness.store.read(readWorkspace),
          backup = createBackup(harness.store, { batchSize: 1 }),
          bytes: Uint8Array[] = [];
        for await (const chunk of backup.chunks) bytes.push(chunk);
        const target = await factory(createWorkspace());
        try {
          await restoreBackup(
            target.store,
            (async function* () {
              await Promise.resolve();
              yield* bytes;
            })(),
            { batchSize: 1 },
          );
          const value = await target.store.read(readWorkspace);
          equal(
            value.schemaVersion,
            WORKSPACE_SCHEMA_VERSION,
            'current version lost',
          );
          equal(value.originals, source.originals, 'signed-in projection lost');
          equal(
            value.browserAttempts,
            source.browserAttempts,
            'both modes lost',
          );
          equal(
            value.decisionEvents,
            source.decisionEvents,
            'fill changed decisions',
          );
          equal(
            value.outcomeEvents,
            source.outcomeEvents,
            'fill changed outcomes',
          );
        } finally {
          await target.dispose();
        }
      }),
  },
  {
    name: 'schema v3 browser journal survives reopen and portable streaming restore without acquiring platform capability',
    run: (factory) =>
      withStore(factory, async (harness) => {
        await harness.store.write(async (tx) => {
          const meta = await tx.meta.get();
          await tx.meta.set({ ...meta, schemaVersion: 3 });
          await tx.browserRuns.add(JOURNAL_FIXTURE.run);
          for (const attempt of JOURNAL_FIXTURE.attempts)
            await tx.browserAttempts.add(attempt);
        });
        const store = await harness.reopen();
        const workspace = await store.read(readWorkspace);
        equal(
          workspace.browserRuns,
          [JOURNAL_FIXTURE.run],
          'run lost after reopen',
        );
        equal(
          workspace.browserAttempts,
          JOURNAL_FIXTURE.attempts,
          'ambiguous attempt lost after reopen',
        );
        equal(workspace.counts.browserAttempts, 2, 'attempt count lost');
        await rejects(() =>
          store.write(async (tx) =>
            tx.browserAttempts.add(JOURNAL_FIXTURE.attempts[0]!),
          ),
        );
        await rejects(() =>
          store.write(async (tx) =>
            tx.browserAttempts.add({
              ...JOURNAL_FIXTURE.attempts[0]!,
              attemptId: 'generated-sequence-decoy',
            }),
          ),
        );
        const backup = createBackup(store, { batchSize: 1 });
        const bytes: Uint8Array[] = [];
        for await (const chunk of backup.chunks) bytes.push(chunk);
        const target = await factory(createWorkspace());
        try {
          await restoreBackup(
            target.store,
            (async function* () {
              await Promise.resolve();
              yield* bytes;
            })(),
            { batchSize: 1 },
          );
          const restored = await target.store.read(readWorkspace);
          equal(
            restored.browserRuns,
            [JOURNAL_FIXTURE.run],
            'backup lost runs',
          );
          equal(
            restored.browserAttempts,
            JOURNAL_FIXTURE.attempts,
            'backup lost ambiguous attempt',
          );
        } finally {
          await target.dispose();
        }
      }),
  },
  {
    name: 'shared event sequences survive reopen and reject duplicates or non-increasing log order',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const first = contractEvent(
          'seq-decision-first',
          'undecided',
          'delete',
        );
        const third = {
          ...contractEvent('seq-decision-third', 'delete', 'keep'),
          seq: 3,
        };
        const second = {
          eventId: 'seq-outcome',
          seq: 2,
          itemId: 'x:1',
          value: 'skipped' as const,
          previous: 'unknown' as const,
          recordedAt: first.decidedAt,
          source: first.source,
          action: { ...first.action, id: 'seq-outcome' },
        };
        await harness.store.write(async (tx) => {
          await tx.decisionEvents.append([first, third]);
          await tx.outcomeEvents.append([second]);
        });
        const reopened = await harness.reopen();
        equal(
          (await reopened.read(async (tx) => tx.runtime.get())).lastEventSeq,
          3,
          'shared sequence high-water mark lost',
        );
        await rejects(() =>
          reopened.write(async (tx) => {
            await tx.outcomeEvents.append([
              {
                ...second,
                eventId: 'seq-duplicate',
                seq: 3,
                previous: 'skipped',
                value: 'unknown',
              },
            ]);
          }),
        );
        await rejects(() =>
          reopened.write(async (tx) => {
            await tx.decisionEvents.append([
              {
                ...third,
                eventId: 'seq-decreasing',
                seq: 2,
                previous: 'keep',
                value: 'later',
              },
            ]);
          }),
        );
        equal(
          (await reopened.read(readWorkspace)).decisionEvents.map(
            (event) => event.seq,
          ),
          [1, 3],
          'decision sequence order changed',
        );
        equal(
          (await reopened.read(readWorkspace)).outcomeEvents.map(
            (event) => event.seq,
          ),
          [2],
          'outcome sequence order changed',
        );
      }),
  },
  {
    name: 'temporary v1 staging records iterate by timestamp, decision ties and array index then clear',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        const decision = {
          itemId: 'x:1',
          value: 'keep' as const,
          decidedAt: '2026-01-01T00:00:00Z',
          source: { kind: 'human' as const, via: 'web-review' as const },
        };
        const outcome = {
          itemId: 'x:1',
          value: 'skipped' as const,
          recordedAt: decision.decidedAt,
        };
        await store.write(async (tx) => {
          await tx.migrationEvents.add({
            id: 'outcome',
            kind: 'outcome',
            index: 0,
            at: decision.decidedAt,
            eventId: 'event-outcome',
            record: outcome,
          });
          await tx.migrationEvents.add({
            id: 'decision-1',
            kind: 'decision',
            index: 1,
            at: decision.decidedAt,
            eventId: 'event-decision-1',
            record: decision,
          });
          await tx.migrationEvents.add({
            id: 'decision-0',
            kind: 'decision',
            index: 0,
            at: decision.decidedAt,
            eventId: 'event-decision-0',
            record: decision,
          });
        });
        const ids: string[] = [];
        await store.read(async (tx) => {
          for await (const record of tx.migrationEvents.iterate())
            ids.push(record.id);
        });
        equal(
          ids,
          ['decision-0', 'decision-1', 'outcome'],
          'legacy timestamp tie order changed',
        );
        await store.write(async (tx) => {
          await tx.migrationEvents.remove('decision-1');
        });
        const remaining: string[] = [];
        await store.read(async (tx) => {
          for await (const record of tx.migrationEvents.iterate())
            remaining.push(record.id);
        });
        equal(
          remaining,
          ['decision-0', 'outcome'],
          'temporary staging removal failed',
        );
        await store.write(async (tx) => {
          await tx.migrationEvents.clear();
        });
        const empty: unknown[] = [];
        await store.read(async (tx) => {
          for await (const record of tx.migrationEvents.iterate())
            empty.push(record);
        });
        equal(empty, [], 'temporary migration records survived clear');
      }),
  },
  {
    name: 'bounded iteration preserves table and log order without skipping or repeating records',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        await store.write(async (tx) => {
          const first = await tx.items.get('x:1');
          assert(first, 'initial item missing');
          await tx.items.put({ ...first, item: { ...first.item, id: 'x:2' } });
          await tx.items.put({ ...first, item: { ...first.item, id: 'x:3' } });
          await tx.decisionEvents.append([
            contractEvent('page-first', 'undecided', 'delete'),
            contractEvent('page-second', 'delete', 'keep'),
          ]);
        });
        await store.read(async (tx) => {
          const ids: string[] = [];
          for await (const record of tx.items.iterate({ offset: 1, limit: 1 }))
            ids.push(record.item.id);
          equal(ids, ['x:2'], 'table offset/limit ignored');
          const events: string[] = [];
          for await (const event of tx.decisionEvents.iterate({
            offset: 1,
            limit: 1,
          }))
            events.push(event.eventId);
          equal(events, ['page-second'], 'log offset/limit ignored');
          const empty: unknown[] = [];
          for await (const record of tx.items.iterate({ limit: 0 }))
            empty.push(record);
          equal(empty, [], 'zero limit yielded records');
        });
      }),
  },
  {
    name: 'initial workspace and detached record reads',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const { store } = harness;
        equal(
          await store.read(readWorkspace),
          contractWorkspace(),
          'initial logical workspace differs',
        );
        const first = await store.read(async (tx) => tx.items.get('x:1'));
        assert(first, 'initial item missing');
        first.item.text = 'MUTATED_OUTSIDE_TRANSACTION';
        const second = await store.read(async (tx) => tx.items.get('x:1'));
        equal(
          second?.item.text,
          'Generated contract input.',
          'read returned live mutable data',
        );
        const review = {
          accountKey: 'x:contract',
          filter: {},
          search: '',
          sort: [{ by: 'createdAt' as const, direction: 'desc' as const }],
          feed: {
            tab: 'all' as const,
            anchors: {},
            views: {
              'x:contract': {
                all: { sort: 'likes' as const },
                kept: { sort: 'oldest' as const, anchor: 'x:1' },
              },
              'instagram:generated': { all: { sort: 'oldest' as const } },
            },
          },
        };
        await store.write(async (tx) => {
          const meta = await tx.meta.get();
          await tx.meta.set({
            ...meta,
            settings: { ...meta.settings, review },
          });
        });
        const reopened = await harness.reopen();
        const saved = await reopened.read(readWorkspace);
        equal(
          saved.settings.review,
          review,
          'SORT-1 per-account/tab sort lost on reopen',
        );
        equal(
          saved.decisionEvents,
          [],
          'SORT-1 view persistence created decisions',
        );
      }),
  },
  {
    name: 'write rollback preserves every table and revision',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        const before = await store.read(readWorkspace);
        await rejects(() =>
          store.write(async (tx) => {
            await tx.decisionEvents.append([
              contractEvent('rollback-event', 'undecided', 'delete'),
            ]);
            await tx.state.put({
              itemId: 'x:1',
              decision: 'delete',
              outcome: 'unknown',
            });
            await tx.runtime.set({ revision: 1 });
            const meta = await tx.meta.get();
            await tx.meta.set({
              ...meta,
              lastBackupAt: '2026-01-03T00:00:00Z',
            });
            throw new Error('Synthetic transaction rejection.');
          }),
        );
        equal(
          await store.read(readWorkspace),
          before,
          'rollback changed logical data',
        );
        equal(
          await store.read(async (tx) => tx.runtime.get()),
          { revision: 0, lastEventSeq: 0 },
          'rollback changed revision',
        );
        equal(
          (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
          'undecided',
          'rollback changed state',
        );
      }),
  },
  {
    name: 'commit atomically persists events state revision and command receipt across reopen',
    run: (factory) =>
      withStore(factory, async (harness) => {
        const event = contractEvent('committed-event', 'undecided', 'delete');
        await harness.store.write(async (tx) => {
          await tx.decisionEvents.append([event]);
          await tx.state.put({
            itemId: 'x:1',
            decision: 'delete',
            outcome: 'unknown',
          });
          await tx.runtime.set({ revision: 1 });
          await tx.commands.add({
            commandId: 'command-1',
            contentHash: 'synthetic-command-hash',
            result: {
              type: 'committed',
              commandId: 'command-1',
              actionId: event.action.id,
              changed: 1,
              revision: 1,
            },
          });
        });
        const reopened = await harness.reopen();
        equal(
          (await reopened.read(readWorkspace)).decisionEvents,
          [event],
          'event did not survive reopen',
        );
        equal(
          (await reopened.read(async (tx) => tx.state.get('x:1')))?.decision,
          'delete',
          'state did not survive reopen',
        );
        equal(
          await reopened.read(async (tx) => tx.runtime.get()),
          { revision: 1, lastEventSeq: 1 },
          'revision did not survive reopen',
        );
        assert(
          await reopened.read(async (tx) => tx.commands.get('command-1')),
          'command receipt missing after reopen',
        );
      }),
  },
  {
    name: 'append order and unique IDs never overwrite a log',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        const first = contractEvent('first', 'undecided', 'delete');
        const second = {
          ...contractEvent('second', 'delete', 'keep'),
          decidedAt: '2025-01-01T00:00:00Z',
        };
        await store.write(async (tx) => {
          await tx.decisionEvents.append([first, second]);
        });
        equal(
          (await store.read(readWorkspace)).decisionEvents,
          [first, second],
          'log reordered by timestamp',
        );
        await rejects(() =>
          store.write(async (tx) => {
            await tx.decisionEvents.append([
              contractEvent('third', 'keep', 'later'),
              first,
            ]);
          }),
        );
        equal(
          (await store.read(readWorkspace)).decisionEvents,
          [first, second],
          'duplicate append partially committed',
        );
      }),
  },
  {
    name: 'read-only and expired accessors reject writes',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        await rejects(() =>
          store.read(async (tx) =>
            (tx as WriteTransaction).state.put({
              itemId: 'x:1',
              decision: 'delete',
              outcome: 'unknown',
            }),
          ),
        );
        let expired: WriteTransaction | undefined;
        await store.write(async (tx) => {
          expired = tx;
          await tx.runtime.get();
        });
        assert(expired, 'transaction not captured');
        await rejects(() =>
          expired!.state.put({
            itemId: 'x:1',
            decision: 'delete',
            outcome: 'unknown',
          }),
        );
        equal(
          (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
          'undecided',
          'read-only or expired transaction wrote',
        );
      }),
  },
  {
    name: 'concurrent compare-and-set writes serialize',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        const change = (value: 'delete' | 'keep') =>
          store.write(async (tx) => {
            const state = await tx.state.get('x:1');
            assert(state, 'state missing');
            if (state.decision !== 'undecided') return false;
            await tx.state.put({ ...state, decision: value });
            return true;
          });
        const results = await Promise.all([change('delete'), change('keep')]);
        equal(
          results,
          [true, false],
          'two writers accepted the same expected state',
        );
        equal(
          (await store.read(async (tx) => tx.state.get('x:1')))?.decision,
          'delete',
          'serialized winner state missing',
        );
      }),
  },
  {
    name: 'label transaction atomically appends submissions and ordered assessments',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
        const source = {
          kind: 'agent' as const,
          name: 'contract-agent',
          version: null,
        };
        const submission = {
          submissionId: 'contract-submission',
          contentHash: `sha256:${'a'.repeat(64)}`,
          source,
          receivedAt: '2026-01-03T00:00:00.000Z',
          labelCount: 2,
        };
        const assessment = {
          assessmentId: 'assessment-1',
          submissionId: submission.submissionId,
          itemId: 'x:1',
          source,
          category: 'unclear',
          risk: 1,
          reason: 'Generated contract reason.',
          evidence: null,
          confidence: null,
          createdAt: submission.receivedAt,
        };
        await rejects(() =>
          store.write(async (tx) => {
            await tx.submissions.add(submission);
            await tx.assessments.append([assessment]);
            throw new Error('Synthetic label rollback.');
          }),
        );
        equal(
          (await store.read(readWorkspace)).submissions,
          [],
          'label rollback left a submission',
        );
        equal(
          (await store.read(readWorkspace)).assessments,
          [],
          'label rollback left assessments',
        );
        const second = {
          ...assessment,
          assessmentId: 'assessment-2',
          createdAt: '2025-01-01T00:00:00.000Z',
        };
        await store.write(async (tx) => {
          await tx.submissions.add(submission);
          await tx.assessments.append([assessment, second]);
        });
        equal(
          (await store.read(readWorkspace)).assessments,
          [assessment, second],
          'assessment append order changed',
        );
        await rejects(() =>
          store.write(async (tx) => {
            await tx.submissions.add(submission);
          }),
        );
        await rejects(() =>
          store.write(async (tx) => {
            await tx.assessments.append([assessment]);
          }),
        );
        equal(
          (await store.read(readWorkspace)).submissions.length,
          1,
          'duplicate submission changed count',
        );
      }),
  },
];
export async function runStoreContract(
  factory: StoreContractFactory,
  onResult?: (name: string) => void,
): Promise<void> {
  for (const check of STORE_CONTRACT_CHECKS) {
    await check.run(factory);
    onResult?.(check.name);
  }
}
