import type { DecisionEvent, Item, WorkspaceV2 } from '@socialprune/core';
import { createWorkspace } from '@socialprune/core/workspace/store';

export const FIXTURE = {
  account: { key: 'x:fixture-person', handle: 'fixture_person' },
  now: '2026-10-11T12:00:00.000Z',
  rows: [
    {
      id: '1001',
      kind: 'post',
      text: 'Generated first post\nsecond line',
      decision: 'delete',
      via: 'local-review',
      bulk: false,
      outcome: 'unknown',
    },
    {
      id: '1002',
      kind: 'reply',
      text: 'Generated reply',
      decision: 'delete',
      via: 'web-review',
      bulk: true,
      outcome: 'unknown',
    },
    {
      id: '1003',
      kind: 'quote',
      text: 'Generated quote',
      decision: 'delete',
      via: 'web-review',
      bulk: true,
      outcome: 'unknown',
    },
    {
      id: '1004',
      kind: 'repost',
      text: 'Generated repost',
      decision: 'delete',
      via: 'local-review',
      bulk: false,
      outcome: 'unknown',
    },
    {
      id: '1005',
      kind: 'post',
      text: 'Generated kept post',
      decision: 'keep',
      via: 'local-review',
      bulk: false,
      outcome: 'unknown',
    },
    {
      id: '1006',
      kind: 'post',
      text: 'Generated manual deletion',
      decision: 'delete',
      via: 'local-review',
      bulk: false,
      outcome: 'deleted-by-user',
    },
  ],
  expected: {
    plannedIds: ['x:1001', 'x:1002', 'x:1003', 'x:1004'],
    canaryOrder: ['x:1001', 'x:1004', 'x:1002', 'x:1003'],
    deleted: 4,
    bulk: 2,
    decisions: 6,
    successStates: [
      'sending',
      'deleted',
      'sending',
      'deleted',
      'sending',
      'deleted',
      'sending',
      'deleted',
    ],
    oneSuccessStates: ['sending', 'deleted'],
    withdrawnStates: ['withdrawn'],
    ambiguousStates: ['sending', 'ambiguous'],
    failureStates: ['sending', 'failed'],
  },
} as const;

export function fixtureWorkspace(
  ids: readonly string[] = FIXTURE.rows.map((row) => row.id),
): WorkspaceV2 {
  const chosen = FIXTURE.rows.filter((row) => ids.includes(row.id));
  const base = createWorkspace({
    id: 'fixture-workspace',
    timeZone: 'Europe/Berlin',
    now: new Date(FIXTURE.now),
  });
  const items: Item[] = chosen.map((row, index) => ({
    id: `x:${row.id}`,
    platform: 'x',
    account: { ...FIXTURE.account },
    kind: row.kind,
    text: row.text,
    createdAt: `2020-01-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    engagement: { likes: 0, reposts: 0 },
    reference: {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    url: null,
    mediaCount: 0,
    provenance: { archive: 'generated-x', file: 'tweets.js', index },
  }));
  const decisionEvents: DecisionEvent[] = chosen.map((row, index) => ({
    eventId: `fixture-decision-${row.id}`,
    seq: index + 1,
    itemId: `x:${row.id}`,
    value: row.decision,
    previous: 'undecided',
    decidedAt: FIXTURE.now,
    source: { kind: 'human', via: row.via },
    action: {
      id: row.bulk ? 'fixture-bulk' : `fixture-action-${row.id}`,
      kind: row.bulk ? 'bulk' : 'single',
      size: row.bulk ? 2 : 1,
      reverts: null,
    },
  }));
  const outcomeEvents = chosen
    .filter((row) => row.outcome !== 'unknown')
    .map((row, index) => ({
      eventId: `fixture-outcome-${row.id}`,
      seq: chosen.length + index + 1,
      itemId: `x:${row.id}`,
      value: row.outcome,
      previous: 'unknown' as const,
      recordedAt: FIXTURE.now,
      source: { kind: 'human' as const, via: row.via },
      action: {
        id: `fixture-outcome-action-${row.id}`,
        kind: 'single' as const,
        size: 1,
        reverts: null,
      },
    }));
  const imports = [
    {
      id: 'fixture-import',
      platform: 'x',
      importedAt: FIXTURE.now,
      archives: ['generated-x'],
      exportCreatedAt: null,
      accounts: [{ ...FIXTURE.account }],
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: items.length,
      status: 'complete' as const,
    },
  ];
  return {
    ...base,
    items,
    imports,
    decisionEvents,
    outcomeEvents,
    counts: {
      imports: 1,
      items: items.length,
      decisionEvents: decisionEvents.length,
      outcomeEvents: outcomeEvents.length,
      assessments: 0,
      submissions: 0,
    },
  };
}
