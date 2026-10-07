import { expect, test } from 'vitest';
import type {
  Assessment,
  AssessmentSource,
  WorkspaceV2,
} from '../model/index.ts';
import { QueryEngine } from './query.ts';
import {
  ReviewRowSchema,
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from './protocol.ts';
import { createMemoryStore, MemoryStoreBacking } from './memory-store.ts';
import { contractWorkspace } from './store-contract.ts';
import { LabelService } from './labels.ts';
import { ReviewService } from './review.ts';
import { mergeImport } from './merge.ts';
import { QueryProjection } from './projection.ts';
import { compareAssessmentSources } from './row-sources.ts';

function assessment(
  assessmentId: string,
  source: AssessmentSource,
  options: { itemId?: string; risk?: number; category?: string } = {},
): Assessment {
  return {
    assessmentId,
    submissionId: null,
    itemId: options.itemId ?? 'x:1',
    source,
    category: options.category ?? 'unclear',
    risk: options.risk ?? 1,
    reason: 'Generated source test needs review.',
    evidence: null,
    confidence: null,
    createdAt: '2026-01-02T00:00:00.000Z',
  };
}

async function rowFrom(workspace: WorkspaceV2) {
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const query = new QueryEngine(store);
    await query.query({
      queryId: 'source-row',
      generation: 1,
      accountKey: 'x:contract',
    });
    return query.window('source-row', 1, 0, 200)[0]!;
  } finally {
    await store.close();
  }
}

test('a row without an assessment has an empty source list and no overflow', async () => {
  const row = await rowFrom(contractWorkspace());
  expect(row).toMatchObject({ sources: [], moreSources: 0 });
  expect(ReviewRowSchema.parse(row)).toEqual(row);
});

test('one agent source is carried as its complete validated metadata', async () => {
  const workspace = contractWorkspace();
  workspace.assessments = [
    assessment('agent-one', {
      kind: 'agent',
      name: 'hand-agent',
      version: '1.0',
    }),
  ];
  workspace.counts.assessments = 1;
  expect(await rowFrom(workspace)).toMatchObject({
    sources: [{ kind: 'agent', name: 'hand-agent', version: '1.0' }],
    moreSources: 0,
  });
});
test('shared rows reply validates its sources and the old source side-channel remains an unknown request', async () => {
  const row = await rowFrom(contractWorkspace());
  const reply = {
    requestId: 'sources-reply',
    type: 'rows',
    queryId: 'sources-query',
    generation: 1,
    offset: 0,
    rows: [row],
  };
  expect(WorkspaceReplySchema.parse(reply)).toEqual(reply);
  expect(
    WorkspaceRequestSchema.safeParse({
      requestId: 'private-source-request',
      type: 'rowSources',
      itemIds: ['x:1'],
    }).success,
  ).toBe(false);
  const { sources: _sources, moreSources: _moreSources, ...legacyRow } = row;
  expect(_sources).toEqual([]);
  expect(_moreSources).toBe(0);
  expect(
    WorkspaceReplySchema.safeParse({ ...reply, rows: [legacyRow] }).success,
  ).toBe(false);
});

test('agent and fixture sources in a demo row are ordered by kind, name and version', async () => {
  const workspace = contractWorkspace();
  workspace.kind = 'demo';
  workspace.assessments = [
    assessment('fixture-first', {
      kind: 'fixture',
      name: 'hand-example',
      version: null,
    }),
    assessment('agent-second', {
      kind: 'agent',
      name: 'hand-agent',
      version: '2',
    }),
  ];
  workspace.counts.assessments = 2;
  expect(await rowFrom(workspace)).toMatchObject({
    sources: [
      { kind: 'agent', name: 'hand-agent', version: '2' },
      { kind: 'fixture', name: 'hand-example', version: null },
    ],
    moreSources: 0,
  });
});

test('latest assessment per kind and name replaces its source version rather than adding an entry', async () => {
  const workspace = contractWorkspace();
  workspace.assessments = [
    assessment(
      'old',
      { kind: 'agent', name: 'same-agent', version: 'old' },
      { risk: 3 },
    ),
    {
      ...assessment(
        'current',
        { kind: 'agent', name: 'same-agent', version: 'current' },
        { risk: 0, category: 'harmless' },
      ),
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];
  workspace.counts.assessments = 2;
  expect(await rowFrom(workspace)).toMatchObject({
    highestRisk: 0,
    categories: ['harmless'],
    sources: [{ kind: 'agent', name: 'same-agent', version: 'current' }],
    moreSources: 0,
  });
});

const NINE_SOURCES: readonly AssessmentSource[] = [
  { kind: 'rules', name: 'zeta', version: '1' },
  { kind: 'agent', name: 'hazel', version: '1' },
  { kind: 'model', name: 'local', version: '3' },
  { kind: 'fixture', name: 'Example', version: null },
  { kind: 'agent', name: 'alfa', version: null },
  { kind: 'agent', name: 'Beta', version: '2' },
  { kind: 'agent', name: 'omega', version: null },
  { kind: 'rules', name: 'alpha', version: '1' },
  { kind: 'model', name: 'other', version: null },
];
const EXPECTED_EIGHT: readonly AssessmentSource[] = [
  { kind: 'agent', name: 'Beta', version: '2' },
  { kind: 'agent', name: 'alfa', version: null },
  { kind: 'agent', name: 'hazel', version: '1' },
  { kind: 'agent', name: 'omega', version: null },
  { kind: 'fixture', name: 'Example', version: null },
  { kind: 'model', name: 'local', version: '3' },
  { kind: 'model', name: 'other', version: null },
  { kind: 'rules', name: 'alpha', version: '1' },
];

test('nine current sources produce eight ordinal entries and one overflow without dropping risk or filter semantics', async () => {
  const workspace = contractWorkspace();
  workspace.kind = 'demo';
  workspace.assessments = NINE_SOURCES.map((source, index) =>
    assessment(`nine-${index}`, source, { risk: index === 0 ? 3 : 0 }),
  );
  workspace.counts.assessments = 9;
  const row = await rowFrom(workspace);
  expect(row.sources).toEqual(EXPECTED_EIGHT);
  expect(row.moreSources).toBe(1);
  expect(row.highestRisk).toBe(3);
  expect(ReviewRowSchema.parse(row)).toEqual(row);
  expect(
    ReviewRowSchema.safeParse({ ...row, sources: NINE_SOURCES }).success,
  ).toBe(false);
  expect(ReviewRowSchema.safeParse({ ...row, moreSources: -1 }).success).toBe(
    false,
  );
  expect(
    ReviewRowSchema.safeParse({
      ...row,
      sources: [{ kind: 'human', name: 'wrong', version: null }],
    }).success,
  ).toBe(false);
  expect(
    ReviewRowSchema.safeParse({
      ...row,
      sources: [{ kind: 'agent', name: 'wrong', version: null, extra: true }],
    }).success,
  ).toBe(false);
  const { sources: _sources, moreSources: _moreSources, ...oldShape } = row;
  expect(_sources).toEqual(EXPECTED_EIGHT);
  expect(_moreSources).toBe(1);
  expect(ReviewRowSchema.safeParse(oldShape).success).toBe(false);
});

test.each([false, true])(
  'LabelService current source metadata reaches the next window, noteChanged=%s',
  async (notify) => {
    const workspace = contractWorkspace();
    const store = createMemoryStore(new MemoryStoreBacking(workspace));
    const query = new QueryEngine(store);
    try {
      await query.query({
        queryId: 'sources',
        generation: 1,
        accountKey: 'x:contract',
      });
      expect(query.window('sources', 1, 0, 200)[0]).toMatchObject({
        sources: [],
        moreSources: 0,
      });
      const labels = new LabelService(store);
      await labels.appendAssessment(
        assessment('notified-first', {
          kind: 'rules',
          name: 'hand-rules',
          version: 'old',
        }),
      );
      if (notify) await query.noteChanged({ revision: 1, itemIds: ['x:1'] });
      await query.query({
        queryId: 'sources',
        generation: 2,
        accountKey: 'x:contract',
      });
      expect(query.window('sources', 2, 0, 200)[0]).toMatchObject({
        sources: [{ kind: 'rules', name: 'hand-rules', version: 'old' }],
        moreSources: 0,
      });
      await labels.appendAssessment(
        assessment('notified-current', {
          kind: 'rules',
          name: 'hand-rules',
          version: null,
        }),
      );
      if (notify) await query.noteChanged({ revision: 2, itemIds: ['x:1'] });
      await query.query({
        queryId: 'sources',
        generation: 3,
        accountKey: 'x:contract',
      });
      const row = query.window('sources', 3, 0, 200)[0]!;
      expect(row).toMatchObject({
        sources: [{ kind: 'rules', name: 'hand-rules', version: null }],
        moreSources: 0,
      });
      row.sources[0]!.name = 'MUTATED_CALLER_SOURCE';
      expect(query.window('sources', 3, 0, 200)[0]?.sources[0]?.name).toBe(
        'hand-rules',
      );
    } finally {
      await store.close();
    }
  },
);

test('cached and rebuilt windows agree including capped sources after decide, 1000-item bulk, undo, redo and merge', async () => {
  const workspace = contractWorkspace();
  workspace.kind = 'demo';
  const template = workspace.items[0]!;
  workspace.items = Array.from({ length: 1000 }, (_, index) => ({
    ...template,
    id: `x:${index}`,
    text: `Generated source differential ${index % 3}.`,
  }));
  workspace.counts.items = 1000;
  workspace.assessments = [
    ...workspace.items.map((item, index) =>
      assessment(
        `diff-${index}`,
        { kind: 'rules', name: 'shared-rules', version: '1' },
        { itemId: item.id, risk: index % 4 },
      ),
    ),
    ...NINE_SOURCES.map((source, index) =>
      assessment(`overflow-${index}`, source, { itemId: 'x:0' }),
    ),
  ];
  workspace.counts.assessments = workspace.assessments.length;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  const cached = new QueryEngine(store);
  const review = new ReviewService(store, { query: cached, via: 'web-review' });
  let generation = 0;
  const compare = async () => {
    const current = ++generation;
    const response = await cached.query({
      queryId: 'diff',
      generation: current,
      accountKey: 'x:contract',
    });
    const fresh = new QueryEngine(store);
    const expected = await fresh.query({
      queryId: 'diff',
      generation: 1,
      accountKey: 'x:contract',
    });
    expect(response.counts).toEqual(expected.counts);
    expect((await cached.selection('diff', current)).ids).toEqual(
      (await fresh.selection('diff', 1)).ids,
    );
    for (let offset = 0; offset < 1000; offset += 200)
      expect(cached.window('diff', current, offset, 200)).toEqual(
        fresh.window('diff', 1, offset, 200),
      );
  };
  try {
    await compare();
    await review.decide({
      commandId: 'source-single',
      itemIds: ['x:0'],
      value: 'keep',
      expected: { 'x:0': 'undecided' },
    });
    await compare();
    await review.previewBulk({
      pageId: 'source-page',
      previewId: 'source-preview',
      queryId: 'diff',
      generation,
      value: 'delete',
      overwrite: ['undecided', 'keep'],
    });
    expect(
      await review.confirmBulk({
        commandId: 'source-bulk',
        pageId: 'source-page',
        previewId: 'source-preview',
      }),
    ).toMatchObject({ changed: 1000 });
    await compare();
    await review.undo('source-undo');
    await compare();
    await review.redo('source-redo');
    await compare();
    const record = {
      id: 'source-reimport',
      platform: 'x',
      importedAt: '2026-01-05T00:00:00.000Z',
      exportCreatedAt: null,
      status: 'complete' as const,
      archives: ['contract'],
      accounts: [template.account],
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 1,
    };
    const merged = await mergeImport(store, record, [
      { ...workspace.items[0]!, engagement: { likes: 7, reposts: 1 } },
    ]);
    await cached.noteChanged({ revision: merged.revision, itemIds: ['x:0'] });
    await compare();
  } finally {
    await store.close();
  }
});

test('interning reuses complete source identities across items and preserves ordinal version ordering', () => {
  const projection = new QueryProjection(0, ['unclear'], null);
  const source = {
    kind: 'agent' as const,
    name: 'shared-agent',
    version: null,
  };
  const first = projection.internSource(source);
  expect(projection.internSource({ ...source })).toBe(first);
  expect(projection.internSource({ ...source, version: '1' })).not.toBe(first);
  expect(compareAssessmentSources(source, { ...source, version: '1' })).toBe(
    -1,
  );
  expect(compareAssessmentSources({ ...source, version: '1' }, source)).toBe(1);
  for (let index = 0; index < 200; index++) {
    const item = { ...contractWorkspace().items[0]!, id: `x:${index}` };
    const slot = projection.upsert(item, true);
    projection.setAssessments(slot, [
      { risk: 1, category: 'unclear', kind: 'agent', sourceId: first },
    ]);
    expect(projection.row(slot).sources).toEqual([source]);
  }
});

test('a capped 200-row window preserves source filters and preview metadata beyond the cap', async () => {
  const workspace = contractWorkspace();
  const template = workspace.items[0]!;
  workspace.items = Array.from({ length: 200 }, (_, index) => ({
    ...template,
    id: `x:${index}`,
  }));
  workspace.counts.items = 200;
  const agents: AssessmentSource[] = Array.from({ length: 8 }, (_, index) => ({
    kind: 'agent',
    name: `agent-${index}`,
    version: null,
  }));
  const omitted: AssessmentSource = {
    kind: 'rules',
    name: 'omitted-rules',
    version: '3',
  };
  workspace.assessments = workspace.items.flatMap((item, itemIndex) =>
    [...agents, omitted].map((source, sourceIndex) =>
      assessment(`row-${itemIndex}-source-${sourceIndex}`, source, {
        itemId: item.id,
        risk: sourceIndex === 8 ? 3 : 0,
      }),
    ),
  );
  workspace.counts.assessments = workspace.assessments.length;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  try {
    const query = new QueryEngine(store);
    expect(
      await query.query({
        queryId: 'capped',
        generation: 1,
        accountKey: 'x:contract',
        filter: {
          sources: ['rules'],
          risk: { min: 3, max: 3, unknown: 'exclude' },
        },
      }),
    ).toMatchObject({ total: 200 });
    const rows = query.window('capped', 1, 0, 200);
    expect(rows).toHaveLength(200);
    for (const row of rows) {
      expect(row.sources).toEqual(agents);
      expect(row.moreSources).toBe(1);
      expect(row.highestRisk).toBe(3);
    }
    const preview = await new ReviewService(store, {
      query,
      via: 'web-review',
    }).previewBulk({
      pageId: 'sources-page',
      previewId: 'sources-preview',
      queryId: 'capped',
      generation: 1,
      value: 'delete',
      overwrite: ['undecided'],
    });
    expect(preview.sample).toHaveLength(20);
    for (const row of preview.sample)
      expect(row).toMatchObject({
        sources: agents,
        moreSources: 1,
        highestRisk: 3,
      });
  } finally {
    await store.close();
  }
});
