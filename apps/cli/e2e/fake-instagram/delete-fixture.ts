import type { WorkspaceV2, InstagramContext } from '@socialprune/core';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import { instagramFixture } from './fixture.ts';

/** Entirely generated export, confirmation evidence and human decisions. */
export async function instagramDeleteFixture(count = 2): Promise<WorkspaceV2> {
  const { workspace, items } = await instagramFixture(count);
  const at = '2026-10-24T12:00:00.000Z';
  workspace.browserRuns = [];
  workspace.browserAttempts = [];
  workspace.instagramContext = [];
  workspace.decisionEvents = [];
  for (const [i, item] of items.entries()) {
    const context: InstagramContext = {
      ...instagramContractRecord(item),
      runId: `generated-context-${i}`,
      attemptId: `generated-send-${i}`,
      confirmedAt: at,
      post: {
        ...instagramContractRecord(item).post,
        code: `GeneratedDelete_${i}`,
        owner: item.reference.ownerHandle!,
      },
      comment: {
        id: `${191919191919191919n + BigInt(i)}`,
        createdAt: item.createdAt,
        expandClicks: 0,
      },
    };
    workspace.instagramContext.push(context);
    workspace.browserRuns.push({
      runId: context.runId,
      accountKey: item.account.key,
      platform: 'instagram',
      mode: 'context',
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: at,
      endReason: 'done',
      bodyShapes: {},
      profileReport: null,
    });
    const sending = {
      seq: i * 2 + 1,
      attemptId: context.attemptId,
      runId: context.runId,
      itemId: item.id,
      action: 'confirm-comment' as const,
      state: 'sending' as const,
      settles: null,
      at,
      code: null,
    };
    workspace.browserAttempts.push(sending, {
      ...sending,
      seq: i * 2 + 2,
      attemptId: `generated-confirmed-${i}`,
      state: 'confirmed',
      settles: sending.attemptId,
    });
    workspace.decisionEvents.push({
      eventId: `generated-decision-${i}`,
      seq: i + 1,
      itemId: item.id,
      value: 'delete',
      previous: 'undecided',
      decidedAt: at,
      source: { kind: 'human', via: 'web-review' },
      action: {
        id: `generated-decision-${i}`,
        kind: 'single',
        size: 1,
        reverts: null,
      },
    });
  }
  workspace.counts = {
    ...workspace.counts,
    browserRuns: count,
    browserAttempts: count * 2,
    instagramContext: count,
    decisionEvents: count,
  };
  return workspace;
}
