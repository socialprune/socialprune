import type { DecisionEvent, Item, WorkspaceV2 } from '../model/index.ts';
import { createWorkspace, readWorkspace } from './store.ts';
import type { WorkspaceStore, WriteTransaction } from './store.ts';
import { canonicalJson } from './canonical.ts';

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
    name: 'initial workspace and detached record reads',
    run: (factory) =>
      withStore(factory, async ({ store }) => {
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
          { revision: 0 },
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
          { revision: 1 },
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
