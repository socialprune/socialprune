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
  if (
    !send ||
    ![
      'confirm-comment',
      'refresh-comment-likes',
      'refresh-comment-replies',
    ].includes(send.action) ||
    send.state !== 'sending'
  )
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
            [
              'confirm-comment',
              'refresh-comment-likes',
              'refresh-comment-replies',
            ].includes(send.action) &&
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
    refreshLikes?: boolean;
    refreshReplies?: boolean;
  }): Promise<number> {
    return this.store.write(async (tx) => {
      const run = await activeRun(tx, input.runId),
        stored = await tx.items.get(input.itemId);
      if (
        stored?.item.platform !== 'instagram' ||
        stored.item.kind !== 'comment' ||
        stored.item.account.key !== run.accountKey ||
        (input.refreshReplies
          ? (await tx.instagramContext.get(input.itemId))?.confirmedBy !==
              'post' ||
            (await tx.instagramContext.get(input.itemId))?.replies !== undefined
          : input.refreshLikes
            ? (await tx.instagramContext.get(input.itemId))?.confirmedBy !==
                'post' ||
              (await tx.instagramContext.get(input.itemId))?.likes !== undefined
            : Boolean(await tx.instagramContext.get(input.itemId))) ||
        Date.parse(input.at) < Date.parse(run.startedAt)
      )
        throw new Error('INVALID_CONTEXT_ATTEMPT');
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === run.runId && attempt.itemId === input.itemId)
          throw new Error('REPEATED_CONTEXT_ATTEMPT');
      const seq = await nextSequence(tx);
      await tx.browserAttempts.add(
        BrowserAttemptSchema.parse({
          attemptId: input.attemptId,
          runId: input.runId,
          itemId: input.itemId,
          at: input.at,
          seq,
          action: input.refreshReplies
            ? 'refresh-comment-replies'
            : input.refreshLikes
              ? 'refresh-comment-likes'
              : 'confirm-comment',
          state: 'sending',
          settles: null,
          code: null,
        }),
      );
      await revision(tx, input.at);
      return seq;
    });
  }

  async step(runId: string, at: string, zone?: string): Promise<number> {
    UtcTimestampSchema.parse(at);
    return this.store.write(async (tx) => {
      const run = await activeRun(tx, runId);
      if (Date.parse(at) < Date.parse(run.lastPageOpenedAt ?? run.startedAt))
        throw new Error('INVALID_CONTEXT_STEP');
      const pageOpens = (run.pageOpens ?? 0) + 1;
      const day = zone
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(at))
        : undefined;
      await tx.browserRuns.put({
        ...run,
        pageOpens,
        lastPageOpenedAt: at,
        ...(zone && day
          ? {
              pageZone: zone,
              pageDays: {
                ...run.pageDays,
                [day]: (run.pageDays?.[day] ?? 0) + 1,
              },
            }
          : {}),
      });
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
      const send = await pending(tx, input.attemptId);
      await settlement(
        tx,
        send,
        ['refresh-comment-likes', 'refresh-comment-replies'].includes(
          send.action,
        )
          ? 'failed'
          : input.state,
        input.at,
        ['refresh-comment-likes', 'refresh-comment-replies'].includes(
          send.action,
        )
          ? (input.code ?? 'INTERRUPTED')
          : input.code,
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
        if (
          record.comment.id !== null &&
          other.comment.id === record.comment.id
        )
          throw new Error('DUPLICATE_CONTEXT_COMMENT');
      await settlement(tx, send, 'confirmed', record.confirmedAt, null);
      await tx.instagramContext.add(record);
      await revision(tx, record.confirmedAt);
    });
  }

  async fillLikes(
    attemptId: string,
    likes: NonNullable<InstagramContext['likes']>,
    at: string,
  ): Promise<void> {
    await this.store.write(async (tx) => {
      const send = await pending(tx, attemptId);
      if (send.action !== 'refresh-comment-likes' || !send.itemId)
        throw new Error('INVALID_CONTEXT_ATTEMPT');
      const prior = await tx.instagramContext.get(send.itemId);
      if (!prior) throw new Error('INVALID_CONTEXT_RECORD');
      await tx.instagramContext.fillLikes({ ...prior, likes });
      await settlement(tx, send, 'read', at, null);
      await revision(tx, at);
    });
  }

  async fillReplies(
    attemptId: string,
    replies: NonNullable<InstagramContext['replies']>,
    at: string,
  ): Promise<void> {
    await this.store.write(async (tx) => {
      const send = await pending(tx, attemptId);
      if (send.action !== 'refresh-comment-replies' || !send.itemId)
        throw new Error('INVALID_CONTEXT_ATTEMPT');
      const prior = await tx.instagramContext.get(send.itemId);
      if (!prior) throw new Error('INVALID_CONTEXT_RECORD');
      await tx.instagramContext.fillReplies({ ...prior, replies });
      await settlement(tx, send, 'read', at, null);
      await revision(tx, at);
    });
  }

  async endRun(input: {
    runId: string;
    endedAt: string;
    endReason: NonNullable<BrowserRun['endReason']>;
    bodyShapes: Record<string, string[]>;
    profileReport: BrowserProfileReport;
    instagramWarning?: BrowserRun['instagramWarning'];
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

  /** Checked IDs select automatic acceptance; hand-reviewed small plans omit them. */
  async acceptCanary(
    runId: string,
    at: string,
    checkedItemIds?: readonly string[],
  ): Promise<void> {
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
      const sends = attempts.filter((attempt) => attempt.state === 'sending'),
        settlements = attempts.filter((attempt) => attempt.settles !== null),
        confirmed = settlements.filter(
          (attempt) => attempt.state === 'confirmed',
        );
      if (
        sends.length < 1 ||
        sends.length > 15 ||
        sends.length !== settlements.length ||
        attempts.length !== sends.length + settlements.length ||
        confirmed.length < 1 ||
        confirmed.length > 5 ||
        (sends.length === 15 && confirmed.length !== 5) ||
        (checkedItemIds !== undefined &&
          (confirmed.length !== 5 ||
            checkedItemIds.length !== 5 ||
            new Set(checkedItemIds).size !== 5))
      )
        throw new Error('INVALID_CANARY');
      const itemIds = new Set<string>();
      for (const send of sends) {
        const settled = settlements.filter(
          (attempt) => attempt.settles === send.attemptId,
        );
        const result = settled[0];
        if (
          send.action !== 'confirm-comment' ||
          send.settles !== null ||
          !send.itemId ||
          itemIds.has(send.itemId) ||
          settled.length !== 1 ||
          result?.action !== 'confirm-comment' ||
          result.itemId !== send.itemId ||
          (result.state !== 'confirmed' &&
            result.state !== 'unavailable' &&
            result.state !== 'unconfirmed' &&
            result.state !== 'not-listed')
        )
          throw new Error('INVALID_CANARY');
        itemIds.add(send.itemId);
        if (result.state === 'confirmed') {
          const record = await tx.instagramContext.get(send.itemId);
          if (
            !record ||
            record.runId !== runId ||
            record.attemptId !== send.attemptId ||
            (checkedItemIds !== undefined &&
              (!checkedItemIds.includes(send.itemId) ||
                !record.post.owner ||
                !record.post.createdAt ||
                record.image.status !== 'stored' ||
                record.screenshot.status !== 'stored'))
          )
            throw new Error('INVALID_CANARY');
        }
      }
      await tx.browserRuns.put(
        BrowserRunSchema.parse({ ...run, canaryAcceptedAt: at }),
      );
      await revision(tx, at);
    });
  }
}
