import { OriginalSchema, validateOriginal } from '../model/original.ts';
import { WORKSPACE_SCHEMA_VERSION } from '../model/index.ts';
import type { Original } from '../model/original.ts';
import type {
  BrowserRun,
  BrowserAttempt,
  BrowserProfileReport,
} from '../model/browser.ts';
import type { WorkspaceStore, WriteTransaction } from './store.ts';

async function nextSequence(tx: WriteTransaction): Promise<number> {
  let seq = 0;
  for await (const attempt of tx.browserAttempts.iterate())
    seq = Math.max(seq, attempt.seq);
  return seq + 1;
}
async function revision(tx: WriteTransaction, at: string) {
  const meta = await tx.meta.get(),
    runtime = await tx.runtime.get();
  await tx.meta.set({
    ...meta,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt: at,
  });
  await tx.runtime.set({ revision: runtime.revision + 1 });
}
/** Capability owned by the fill runner: no decision or outcome method. */
export class OriginalsFillWriter {
  private readonly store: WorkspaceStore;
  constructor(store: WorkspaceStore) {
    this.store = store;
  }
  async startRun(input: {
    runId: string;
    accountKey: string;
    planHash: string;
    canary: boolean;
    startedAt: string;
    ownerPid?: number;
  }) {
    await this.store.write(async (tx) => {
      const runs: BrowserRun[] = [];
      for await (const run of tx.browserRuns.iterate()) runs.push(run);
      for (const run of runs)
        if (
          run.accountKey === input.accountKey &&
          run.mode === 'fill' &&
          !run.endedAt
        ) {
          for await (const attempt of tx.browserAttempts.iterate())
            if (
              attempt.runId === run.runId &&
              attempt.action === 'read-post' &&
              attempt.state === 'sending'
            ) {
              let settled = false;
              for await (const other of tx.browserAttempts.iterate())
                if (other.settles === attempt.attemptId) settled = true;
              if (!settled)
                await tx.browserAttempts.add({
                  ...attempt,
                  seq: await nextSequence(tx),
                  attemptId: crypto.randomUUID(),
                  state: 'failed',
                  settles: attempt.attemptId,
                  at: input.startedAt,
                  code: 'INTERRUPTED',
                });
            }
          await tx.browserRuns.put({
            ...run,
            endedAt: input.startedAt,
            endReason: 'error',
          });
        }
      await tx.browserRuns.add({
        runId: input.runId,
        platform: 'x',
        accountKey: input.accountKey,
        mode: 'fill',
        planHash: input.planHash,
        startedAt: input.startedAt,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
        canaryAcceptedAt: null,
        ...(input.ownerPid ? { ownerPid: input.ownerPid } : {}),
      });
      await revision(tx, input.startedAt);
    });
  }
  async sending(input: {
    attemptId: string;
    runId: string;
    originalId: string;
    at: string;
  }): Promise<number> {
    return this.store.write(async (tx) => {
      const run = await tx.browserRuns.get(input.runId),
        original = await tx.originals.get(input.originalId);
      if (run?.mode !== 'fill' || run.endedAt || !original)
        throw new Error('INVALID_FILL_ATTEMPT');
      const seq = await nextSequence(tx);
      await tx.browserAttempts.add({
        seq,
        attemptId: input.attemptId,
        runId: input.runId,
        itemId: null,
        originalId: input.originalId,
        action: 'read-post',
        state: 'sending',
        settles: null,
        at: input.at,
        code: null,
      });
      await tx.browserRuns.put({
        ...run,
        pageOpens: (run.pageOpens ?? 0) + 1,
        lastPageOpenedAt: input.at,
      });
      await revision(tx, input.at);
      return seq;
    });
  }
  async settle(
    input: {
      attemptId: string;
      state: 'read' | 'not-found' | 'tombstone' | 'unavailable' | 'failed';
      at: string;
      code: string | null;
    },
    originals: Original[],
  ): Promise<void> {
    await this.store.write(async (tx) => {
      const prior = await tx.browserAttempts.get(input.attemptId);
      if (
        prior?.action !== 'read-post' ||
        prior.state !== 'sending' ||
        !prior.originalId
      )
        throw new Error('INVALID_FILL_ATTEMPT');
      for await (const value of tx.browserAttempts.iterate())
        if (value.settles === prior.attemptId)
          throw new Error('SETTLED_FILL_ATTEMPT');
      const attemptId = crypto.randomUUID();
      if (
        (input.state === 'failed' && originals.length) ||
        (input.state !== 'failed' &&
          !originals.some((record) => record.id === prior.originalId))
      )
        throw new Error('INVALID_FILL_RECORD');
      const result: BrowserAttempt = {
        ...prior,
        attemptId,
        seq: await nextSequence(tx),
        settles: prior.attemptId,
        state: input.state,
        at: input.at,
        code: input.code,
      };
      const state: NonNullable<Original['signedIn']>['status'] =
        input.state === 'failed' ? 'not-found' : input.state;
      await tx.browserAttempts.add(result);
      for (const record of originals) {
        const value = OriginalSchema.parse(record);
        const stored = {
          ...value,
          signedIn: {
            status: state,
            at: input.at,
            runId: prior.runId,
            attemptId,
            reason: value.signedIn?.reason ?? null,
          },
        };
        validateOriginal(stored);
        await tx.originals.put(stored);
      }
      await revision(tx, input.at);
    });
  }
  async endRun(input: {
    runId: string;
    endedAt: string;
    endReason: NonNullable<BrowserRun['endReason']>;
    bodyShapes: Record<string, string[]>;
    profileReport: BrowserProfileReport;
    warningKind?: BrowserRun['warningKind'];
  }) {
    await this.store.write(async (tx) => {
      const run = await tx.browserRuns.get(input.runId);
      if (run?.mode !== 'fill' || run.endedAt)
        throw new Error('INVALID_FILL_RUN');
      await tx.browserRuns.put({ ...run, ...input });
      await revision(tx, input.endedAt);
    });
  }
  async acceptCanary(runId: string, at: string) {
    await this.store.write(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      if (
        run?.mode !== 'fill' ||
        run.endReason !== 'canary' ||
        run.canaryAcceptedAt
      )
        throw new Error('INVALID_CANARY');
      const attempts: BrowserAttempt[] = [];
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === runId) attempts.push(attempt);
      const sends = attempts.filter((attempt) => attempt.state === 'sending');
      if (
        sends.length < 1 ||
        sends.length > 5 ||
        sends.some(
          (send) =>
            !attempts.some(
              (attempt) =>
                attempt.settles === send.attemptId &&
                ['read', 'not-found', 'tombstone', 'unavailable'].includes(
                  attempt.state,
                ),
            ),
        )
      )
        throw new Error('INVALID_CANARY');
      await tx.browserRuns.put({ ...run, canaryAcceptedAt: at });
      await revision(tx, at);
    });
  }
}
