import type { Item, WorkspaceV2 } from '@socialprune/core';
import { createWorkspace } from '@socialprune/core/workspace/store';

/** All expected state below is hand-built input, independent of SQLite/core projections. */
export function browserWorkspace(): WorkspaceV2 {
  const workspace = createWorkspace({
    id: 'generated-browser-workspace',
    now: new Date('2026-01-01T00:00:00Z'),
    timeZone: 'Europe/Berlin',
  });
  const base: Item = {
    id: 'x:101',
    platform: 'x',
    account: { key: 'x:generated', handle: null },
    kind: 'post',
    text: 'Generated text for backup tests.',
    createdAt: '2026-10-06T23:30:00Z',
    mediaCount: 0,
    engagement: { likes: 2, reposts: 1 },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: 'https://x.com/i/web/status/101',
    provenance: { archive: 'generated', file: 'posts.json', index: 0 },
  };
  workspace.imports = [
    {
      id: 'generated-import',
      platform: 'x',
      importedAt: workspace.createdAt,
      archives: ['generated'],
      exportCreatedAt: '2026-10-01T00:00:00Z',
      accounts: [base.account],
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 2,
      status: 'complete',
    },
  ];
  workspace.items = [
    base,
    {
      ...base,
      id: 'x:102',
      kind: 'repost',
      text: 'Generated repost.',
      provenance: { ...base.provenance, index: 1 },
    },
  ];
  const source = {
    kind: 'agent' as const,
    name: 'generated-agent',
    version: null,
  };
  workspace.submissions = [
    {
      submissionId: 'generated-submission',
      contentHash: `sha256:${'a'.repeat(64)}`,
      source,
      receivedAt: workspace.createdAt,
      labelCount: 1,
    },
  ];
  workspace.assessments = [
    {
      assessmentId: 'generated-assessment',
      submissionId: 'generated-submission',
      itemId: base.id,
      source,
      category: 'unclear',
      risk: 2,
      reason: 'Generated reason for the test.',
      evidence: null,
      confidence: null,
      createdAt: workspace.createdAt,
    },
  ];
  workspace.decisionEvents = [
    {
      eventId: 'generated-delete',
      seq: 1,
      itemId: base.id,
      value: 'delete',
      previous: 'undecided',
      decidedAt: workspace.createdAt,
      source: { kind: 'human', via: 'web-review' },
      action: {
        id: 'generated-delete',
        kind: 'single',
        size: 1,
        reverts: null,
      },
    },
    {
      eventId: 'generated-keep',
      seq: 3,
      itemId: 'x:102',
      value: 'keep',
      previous: 'undecided',
      decidedAt: workspace.createdAt,
      source: { kind: 'human', via: 'local-review' },
      action: { id: 'generated-keep', kind: 'single', size: 1, reverts: null },
    },
  ];
  workspace.outcomeEvents = [
    {
      eventId: 'generated-skipped',
      seq: 2,
      itemId: base.id,
      value: 'skipped',
      previous: 'unknown',
      recordedAt: workspace.createdAt,
      source: { kind: 'human', via: 'web-review' },
      action: {
        id: 'generated-skipped',
        kind: 'single',
        size: 1,
        reverts: null,
      },
    },
  ];
  workspace.counts = {
    imports: 1,
    items: 2,
    assessments: 1,
    submissions: 1,
    decisionEvents: 2,
    outcomeEvents: 1,
  };
  return workspace;
}
