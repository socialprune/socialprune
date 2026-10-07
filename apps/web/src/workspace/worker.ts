import '@socialprune/core/browser-init';
import { createWorkspace, records } from '@socialprune/core/workspace/store';
import type { StoredItem } from '@socialprune/core/workspace/store';
import { QueryEngine } from '@socialprune/core/workspace/query';
import { ReviewService } from '@socialprune/core/workspace/review';
import {
  WorkspaceRequestSchema,
  WorkspaceReplySchema,
  WorkspaceNotificationSchema,
} from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceRequest,
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
import type { Item, ImportRecord, ImportSummary } from '@socialprune/core';
import { IndexedDBStore } from './idb-store.ts';
import { activeWorkspace, publishWorkspace } from './registry.ts';
import { observePolicyViolations } from '../sw/observe-policy.ts';
import { writeBackup, stageRestore } from './backup.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const changes = new BroadcastChannel('sp-workspace');
let store: IndexedDBStore | null = null;
let query: QueryEngine | null = null;
let review: ReviewService | null = null;
let workspaceId = '';

function post(reply: WorkspaceReply) {
  scope.postMessage(WorkspaceReplySchema.parse(reply));
}
function notify(revision: number) {
  scope.postMessage(
    WorkspaceNotificationSchema.parse({
      type: 'changed',
      revision,
      itemIds: 'many',
      countsChanged: true,
    }),
  );
  changes.postMessage({ workspaceId, revision });
}
observePolicyViolations(scope, (violation) =>
  scope.postMessage({ type: 'policy-violation', violation }),
);

async function summary(): Promise<WorkspaceSummary> {
  if (!store) throw new Error('Workspace closed.');
  return store.read(async (tx) => {
    const meta = await tx.meta.get();
    const runtime = await tx.runtime.get();
    const imports = await records(tx.imports);
    const completed = new Set(
      imports.filter(({ status }) => status === 'complete').map(({ id }) => id),
    );
    const counts = {
      imports: imports.length,
      items: 0,
      assessments: 0,
      submissions: 0,
      decisionEvents: 0,
      outcomeEvents: 0,
    };
    const decisions = { keep: 0, delete: 0, later: 0, undecided: 0 };
    const outcomes = { 'deleted-by-user': 0, skipped: 0, unknown: 0 };
    const accounts = new Map<string, Item['account']>();
    for await (const { item, importId } of tx.items.iterate()) {
      if (importId && !completed.has(importId)) continue;
      counts.items++;
      accounts.set(item.account.key, item.account);
      const state = await tx.state.get(item.id);
      decisions[state?.decision ?? 'undecided']++;
      outcomes[state?.outcome ?? 'unknown']++;
    }
    for (const name of [
      'assessments',
      'submissions',
      'decisionEvents',
      'outcomeEvents',
    ] as const)
      for await (const _record of tx[name].iterate()) {
        void _record;
        counts[name]++;
      }
    return {
      workspaceId: meta.id,
      schemaVersion: 2,
      kind: meta.kind,
      accounts: [...accounts.values()],
      counts,
      decisions,
      outcomes,
      lastBackupAt: meta.lastBackupAt,
      timeZone: meta.settings.timeZone,
      revision: runtime.revision,
    };
  });
}

async function open(id: string) {
  review?.closeSession();
  await store?.close();
  workspaceId =
    id === 'active' ? ((await activeWorkspace()) ?? crypto.randomUUID()) : id;
  const initial = createWorkspace({ id: workspaceId });
  store = await IndexedDBStore.open(workspaceId, initial, () => {
    scope.postMessage({ type: 'storageLifecycle', state: 'reload-required' });
  });
  query = new QueryEngine(store);
  review = new ReviewService(store, { query, via: 'web-review' });
  await publishWorkspace({
    id: workspaceId,
    kind: initial.kind,
    createdAt: initial.createdAt,
  });
  return summary();
}

interface ImportBatch {
  type: 'batch';
  token: number;
  items: Item[];
}
interface ImportTerminal {
  type: 'summary' | 'aborted';
  token: number;
  summary?: ImportSummary;
}
async function attach(port: MessagePort, requestId: string) {
  if (!store) throw new Error('Workspace closed.');
  const target = store;
  const preserveExisting = (await summary()).counts.items > 0;
  const importIds = new Map<string, string>();
  let count = 0;
  let queue = Promise.resolve();
  const keyOf = (item: Item) => item.platform;
  let conflicts = 0;
  port.onmessage = (event: MessageEvent<ImportBatch | ImportTerminal>) => {
    const message = event.data;
    queue = queue
      .then(async () => {
        if (message.type === 'batch') {
          const stored: StoredItem[] = [];
          for (const item of message.items) {
            const key = keyOf(item);
            let id = importIds.get(key);
            if (!id) {
              id = crypto.randomUUID();
              importIds.set(key, id);
              const record: ImportRecord = {
                id,
                platform: item.platform,
                accounts: [item.account],
                archives: [item.provenance.archive],
                variant: null,
                adapter: { name: 'workspace-stream', version: '1' },
                importedAt: new Date().toISOString(),
                exportCreatedAt: null,
                status: 'incomplete',
                itemCount: 0,
                diagnostics: [],
              };
              await target.write(async (tx) => tx.imports.put(record));
            }
            stored.push({ item, importId: id, metadataImportId: id });
          }
          conflicts += (await target.putItemBatch(stored, preserveExisting))
            .conflicts;
          count += message.items.length;
          port.postMessage({
            type: 'batch-stored',
            token: message.token,
            count,
          });
          post({ type: 'progress', requestId, completed: count, total: null });
        } else if (message.type === 'summary' && message.summary) {
          await target.write(async (tx) => {
            for (const record of message.summary!.records) {
              const keys = [...importIds].filter(
                ([key]) => key === record.platform,
              );
              if (!keys.length)
                await tx.imports.put({ ...record, status: 'complete' });
              for (const [, id] of keys)
                await tx.imports.put({
                  ...record,
                  id,
                  status: 'complete',
                  diagnostics: conflicts
                    ? [
                        ...record.diagnostics,
                        {
                          category: 'conflicting-items',
                          status: 'skipped',
                          files: [],
                          count: conflicts,
                          message: null,
                        },
                      ]
                    : record.diagnostics,
                });
            }
            const runtime = await tx.runtime.get();
            await tx.runtime.set({ revision: runtime.revision + 1 });
          });
          port.postMessage({ type: 'settled', token: message.token });
          post({ type: 'done', requestId });
          notify((await summary()).revision);
        } else {
          // Incomplete owners keep their imported rows hidden; the next import
          // or restore never publishes these unacknowledged partial records.
          await target.discardIncomplete([...importIds.values()]);
          port.postMessage({ type: 'settled', token: message.token });
          post({ type: 'failed', requestId, code: 'CANCELLED' });
        }
      })
      .catch(() => {
        port.postMessage({ type: 'storage-failed', token: message.token });
        post({ type: 'failed', requestId, code: 'STORAGE' });
      });
  };
  port.start();
  port.postMessage({ type: 'ready' });
}

async function handle(input: WorkspaceRequest) {
  const requestId = input.requestId;
  if (input.type === 'open') {
    post({ type: 'opened', requestId, summary: await open(input.workspaceId) });
    return;
  }
  if (!store || !query || !review) throw new Error('Workspace closed.');
  switch (input.type) {
    case 'query': {
      try {
        const result = await query.query(input);
        post({ type: 'queryResult', requestId, ...result });
      } catch (error) {
        if ((error as { code?: string }).code === 'CANCELLED')
          post({
            type: 'cancelled',
            requestId,
            queryId: input.queryId,
            generation: input.generation,
          });
        else throw error;
      }
      break;
    }
    case 'window':
      post({
        type: 'rows',
        requestId,
        queryId: input.queryId,
        generation: input.generation,
        offset: input.offset,
        rows: query.window(
          input.queryId,
          input.generation,
          input.offset,
          input.limit,
        ),
      });
      break;
    case 'detail': {
      const result = await store.read(async (tx) => {
        const stored = await tx.items.get(input.itemId);
        if (!stored) throw new Error('Unknown item.');
        const assessments = [];
        for await (const assessment of tx.assessments.iterate())
          if (assessment.itemId === input.itemId) assessments.push(assessment);
        const events = [];
        for (const log of [tx.decisionEvents, tx.outcomeEvents])
          for await (const event of log.iterate())
            if (event.itemId === input.itemId) events.push(event);
        return { item: stored.item, assessments, events };
      });
      post({ type: 'itemDetail', requestId, ...result });
      break;
    }
    case 'decide':
    case 'outcome': {
      const result =
        input.type === 'decide'
          ? await review.decide({
              commandId: input.commandId,
              itemIds: input.itemIds,
              value: input.value,
              expected: input.expected,
            })
          : await review.outcome({
              commandId: input.commandId,
              itemIds: input.itemIds,
              value: input.value,
              expected: input.expected,
            });
      post({ ...result, requestId });
      if (result.type === 'committed') notify(result.revision);
      break;
    }
    case 'previewBulk': {
      const { requestId: _requestId, type: _type, ...preview } = input;
      void _requestId;
      void _type;
      post({
        ...(await review.previewBulk(preview)),
        type: 'bulkPreview',
        requestId,
      });
      break;
    }
    case 'confirmBulk': {
      const result = await review.confirmBulk({
        commandId: input.commandId,
        pageId: input.pageId,
        previewId: input.previewId,
      });
      post({ ...result, requestId });
      if (result.type === 'committed') notify(result.revision);
      break;
    }
    case 'releasePreview':
      review.releasePreview(input.pageId, input.previewId);
      post({ type: 'released', requestId });
      break;
    case 'undo':
    case 'redo': {
      const result = await review[input.type](input.commandId);
      post({ ...result, requestId });
      if (result.type === 'committed') notify(result.revision);
      break;
    }
    case 'history':
      post({
        type: 'historyEntries',
        requestId,
        entries: await review.history(input.limit),
      });
      break;
    case 'revision':
      post({
        type: 'revision',
        requestId,
        revision: (await summary()).revision,
      });
      break;
    case 'attachImport':
      await attach(input.port, requestId);
      break;
    case 'shutdown':
      review.closeSession();
      await store.close();
      store = null;
      post({ type: 'done', requestId });
      break;
    case 'backup': {
      await writeBackup(store, input.target);
      post({ type: 'done', requestId });
      break;
    }
    case 'restore': {
      const stage = await stageRestore(input.file);
      await store.close();
      store = stage.store;
      workspaceId = stage.storageId;
      query = new QueryEngine(store);
      review = new ReviewService(store, { query, via: 'web-review' });
      post({ type: 'opened', requestId, summary: await summary() });
      break;
    }
  }
}
scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = WorkspaceRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    const id = (event.data as { requestId?: unknown })?.requestId;
    if (typeof id === 'string' && id)
      post({ type: 'failed', requestId: id, code: 'INVALID_REQUEST' });
    return;
  }
  void handle(parsed.data).catch((error: unknown) => {
    const code = (error as { code?: string }).code;
    const rejected = WorkspaceReplySchema.safeParse({
      type: 'failed',
      requestId: parsed.data.requestId,
      code: code ?? 'STORAGE',
    });
    post(
      rejected.success
        ? rejected.data
        : { type: 'failed', requestId: parsed.data.requestId, code: 'STORAGE' },
    );
  });
});
changes.onmessage = (
  event: MessageEvent<{ workspaceId: string; revision: number }>,
) => {
  if (event.data.workspaceId === workspaceId) {
    scope.postMessage(
      WorkspaceNotificationSchema.parse({
        type: 'changed',
        revision: event.data.revision,
        itemIds: 'many',
        countsChanged: true,
      }),
    );
  }
};
