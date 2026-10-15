import {
  BrowserAttemptSchema,
  BrowserRunSchema,
  InstagramContextSchema,
  UtcTimestampSchema,
  WORKSPACE_SCHEMA_VERSION,
  validateInstagramContextItem,
} from '../model/index.ts';
import type {
  BrowserAttempt,
  BrowserProfileReport,
  BrowserRun,
  InstagramContext,
} from '../model/index.ts';
import type { WorkspaceStore, WriteTransaction } from './store.ts';

async function nextSequence(tx: WriteTransaction): Promise<number> {
  let seq = 0;
  for await (const attempt of tx.browserAttempts.iterate())
    seq = Math.max(seq, attempt.seq);
  return seq + 1;
}
async function revision(tx: WriteTransaction, at: string): Promise<void> {
  const meta = await tx.meta.get(),
    runtime = await tx.runtime.get();
  await tx.meta.set({
    ...meta,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt: at,
  });
  await tx.runtime.set({ revision: runtime.revision + 1 });
}
async function activeRun(
  tx: WriteTransaction,
  runId: string,
): Promise<BrowserRun> {
  const run = await tx.browserRuns.get(runId);
  if (run?.platform !== 'instagram' || run.mode !== 'context' || run.endedAt)
    throw new Error('INVALID_CONTEXT_RUN');
  return run;
}
async function pending(
  tx: WriteTransaction,
  attemptId: string,
): Promise<BrowserAttempt> {
  const send = await tx.browserAttempts.get(attemptId);
  if (send?.action !== 'confirm-comment' || send.state !== 'sending')
    throw new Error('INVALID_CONTEXT_ATTEMPT');
  await activeRun(tx, send.runId);
  for await (const attempt of tx.browserAttempts.iterate())
    if (attempt.settles === attemptId)
      throw new Error('SETTLED_CONTEXT_ATTEMPT');
  return send;
}
async function settlement(
  tx: WriteTransaction,
  send: BrowserAttempt,
  state: BrowserAttempt['state'],
  at: string,
  code: string | null,
): Promise<void> {
  if (Date.parse(at) < Date.parse(send.at))
    throw new Error('INVALID_CONTEXT_ATTEMPT');
  await tx.browserAttempts.add(
    BrowserAttemptSchema.parse({
      ...send,
      seq: await nextSequence(tx),
      attemptId: crypto.randomUUID(),
      settles: send.attemptId,
      state,
      at,
      code,
    }),
  );
}

/** Instagram runner capability only. No decision or outcome methods. */
export class InstagramContextWriter {
  private readonly store: WorkspaceStore;
  constructor(store: WorkspaceStore) {
    this.store = store;
  }

  async startRun(input: {
    runId: string;
    accountKey: string;
    planHash: string;
    startedAt: string;
    canary?: boolean;
    ownerPid?: number;
  }): Promise<void> {
    const run = BrowserRunSchema.parse({
      runId: input.runId,
      accountKey: input.accountKey,
      platform: 'instagram',
      mode: 'context',
      planHash: input.planHash,
      startedAt: input.startedAt,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
      canaryAcceptedAt: null,
      pageOpens: 0,
      ...(input.ownerPid === undefined ? {} : { ownerPid: input.ownerPid }),
    });
    await this.store.write(async (tx) => {
      const oldRuns: BrowserRun[] = [];
      for await (const old of tx.browserRuns.iterate())
        if (
          old.accountKey === run.accountKey &&
          old.platform === 'instagram' &&
          old.mode === 'context' &&
          !old.endedAt
        )
          oldRuns.push(old);
      for (const old of oldRuns) {
        const attempts: BrowserAttempt[] = [];
        for await (const attempt of tx.browserAttempts.iterate())
          if (attempt.runId === old.runId) attempts.push(attempt);
        for (const send of attempts)
          if (
            send.action === 'confirm-comment' &&
            send.state === 'sending' &&
            !attempts.some((attempt) => attempt.settles === send.attemptId)
          )
            await settlement(tx, send, 'failed', run.startedAt, 'INTERRUPTED');
        await tx.browserRuns.put({
          ...old,
          endedAt: run.startedAt,
          endReason: 'error',
        });
      }
      await tx.browserRuns.add(run);
      await revision(tx, run.startedAt);
    });
  }

  async sending(input: {
    attemptId: string;
    runId: string;
    itemId: string;
    at: string;
  }): Promise<number> {
    return this.store.write(async (tx) => {
      const run = await activeRun(tx, input.runId),
        stored = await tx.items.get(input.itemId);
      if (
        stored?.item.platform !== 'instagram' ||
        stored.item.kind !== 'comment' ||
        stored.item.account.key !== run.accountKey ||
        (await tx.instagramContext.get(input.itemId)) ||
        Date.parse(input.at) < Date.parse(run.startedAt)
      )
        throw new Error('INVALID_CONTEXT_ATTEMPT');
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === run.runId && attempt.itemId === input.itemId)
          throw new Error('REPEATED_CONTEXT_ATTEMPT');
      const seq = await nextSequence(tx);
      await tx.browserAttempts.add(
        BrowserAttemptSchema.parse({
          ...input,
          seq,
          action: 'confirm-comment',
          state: 'sending',
          settles: null,
          code: null,
        }),
      );
      await revision(tx, input.at);
      return seq;
    });
  }

  async step(runId: string, at: string): Promise<number> {
    UtcTimestampSchema.parse(at);
    return this.store.write(async (tx) => {
      const run = await activeRun(tx, runId);
      if (Date.parse(at) < Date.parse(run.lastPageOpenedAt ?? run.startedAt))
        throw new Error('INVALID_CONTEXT_STEP');
      const pageOpens = (run.pageOpens ?? 0) + 1;
      await tx.browserRuns.put({ ...run, pageOpens, lastPageOpenedAt: at });
      await revision(tx, at);
      return pageOpens;
    });
  }

  async settle(input: {
    attemptId: string;
    state: 'unconfirmed' | 'not-listed' | 'unavailable' | 'failed';
    at: string;
    code: string | null;
  }): Promise<void> {
    if (
      !['unconfirmed', 'not-listed', 'unavailable', 'failed'].includes(
        input.state,
      )
    )
      throw new Error('INVALID_CONTEXT_ATTEMPT');
    await this.store.write(async (tx) => {
      await settlement(
        tx,
        await pending(tx, input.attemptId),
        input.state,
        input.at,
        input.code,
      );
      await revision(tx, input.at);
    });
  }

  async confirm(input: InstagramContext): Promise<void> {
    const record = InstagramContextSchema.parse(input);
    await this.store.write(async (tx) => {
      const send = await pending(tx, record.attemptId),
        run = await activeRun(tx, send.runId);
      validateInstagramContextItem(
        record,
        (await tx.items.get(record.itemId))?.item,
      );
      if (
        send.itemId !== record.itemId ||
        send.runId !== record.runId ||
        run.accountKey !== record.accountKey
      )
        throw new Error('INVALID_CONTEXT_RECORD');
      for await (const other of tx.instagramContext.iterate())
        if (other.comment.id === record.comment.id)
          throw new Error('DUPLICATE_CONTEXT_COMMENT');
      await settlement(tx, send, 'confirmed', record.confirmedAt, null);
      await tx.instagramContext.add(record);
      await revision(tx, record.confirmedAt);
    });
  }

  async endRun(input: {
    runId: string;
    endedAt: string;
    endReason: NonNullable<BrowserRun['endReason']>;
    bodyShapes: Record<string, string[]>;
    profileReport: BrowserProfileReport;
  }): Promise<void> {
    await this.store.write(async (tx) => {
      const run = await activeRun(tx, input.runId);
      const attempts: BrowserAttempt[] = [];
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === run.runId) attempts.push(attempt);
      if (
        Date.parse(input.endedAt) < Date.parse(run.startedAt) ||
        attempts.some(
          (attempt) =>
            attempt.state === 'sending' &&
            !attempts.some((other) => other.settles === attempt.attemptId),
        )
      )
        throw new Error('UNSETTLED_CONTEXT_RUN');
      await tx.browserRuns.put(BrowserRunSchema.parse({ ...run, ...input }));
      await revision(tx, input.endedAt);
    });
  }

  async acceptCanary(runId: string, at: string): Promise<void> {
    await this.store.write(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      if (
        run?.platform !== 'instagram' ||
        run.mode !== 'context' ||
        run.endReason !== 'canary' ||
        !run.endedAt ||
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
        !attempts.some((attempt) => attempt.state === 'confirmed') ||
        sends.some(
          (send) =>
            !attempts.some(
              (attempt) =>
                attempt.settles === send.attemptId &&
                [
                  'confirmed',
                  'unconfirmed',
                  'not-listed',
                  'unavailable',
                ].includes(attempt.state),
            ),
        )
      )
        throw new Error('INVALID_CANARY');
      await tx.browserRuns.put(
        BrowserRunSchema.parse({ ...run, canaryAcceptedAt: at }),
      );
      await revision(tx, at);
    });
  }
}
