import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import type { WorkspaceV2 } from '@socialprune/core';
import {
  BatchSchema,
  LabelSubmissionSchema,
  SummarySchema,
} from '@socialprune/core/workspace/payloads';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import type { WriteTransaction } from '@socialprune/core/workspace/store';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { CliResultSchema } from '../cli/schemas.ts';
import { capturedContext } from '../cli/test/context.ts';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import type { LabelFile } from '@socialprune/core/workspace/payloads';

const demo = new URL('../../../../fixtures/synthetic/demo/', import.meta.url);
const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);
const expected = new URL(
  '../../../../fixtures/synthetic/x/current-minimal/expected.json',
  import.meta.url,
);

async function invoke(args: string[], json = true) {
  const capture = capturedContext(
    createNodeContext({ write() {} }, { write() {} }).services,
  );
  const recorder = networkRecorder();
  try {
    const code = await executeCli(
      [...args, ...(json ? ['--json'] : [])],
      capture.context,
    );
    expect(recorder.calls).toEqual([]);
    expect(capture.opened).toEqual([]);
    return {
      code,
      result: json
        ? CliResultSchema.parse(JSON.parse(capture.stdout.join('')))
        : null,
      capture,
    };
  } finally {
    recorder.restore();
  }
}
async function load(workspace: string) {
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    return await store.read(readWorkspace);
  } finally {
    await store.close();
  }
}
function labels(items: WorkspaceV2['items']): LabelFile {
  return {
    schemaVersion: 1,
    submissionId: 'hand-built-labels',
    source: { kind: 'agent', name: 'hand-built-agent', version: null },
    labels: items.map((item) => ({
      itemId: item.id,
      contentHash:
        'sha256:' +
        createHash('sha256').update(item.text, 'utf8').digest('hex'),
      category: 'harmless',
      risk: 0,
      reason: 'This generated entry is a plain statement.',
      evidence: item.text,
      confidence: null,
    })),
  };
}

test('risk 2 and 3 null-evidence warnings are count-only, advisory and consistent for dry-run, submit and duplicate', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-label-evidence-'),
  );
  const workspace = join(directory, 'workspace');
  const file = join(directory, 'labels.json');
  const fixture = JSON.parse(await readFile(expected, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  const initial = createWorkspace();
  initial.items = Array.from({ length: 7 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:generated-evidence-${index}`,
    text: `Generated evidence marker ${index}.`,
  }));
  initial.counts.items = initial.items.length;
  const labelFile = labels(initial.items);
  // The cases are authored with the fixture, not returned by the warning code:
  // 0/1 with null, 2/3 with null, 2/3 with quotes, and 3 with a dropped quote.
  labelFile.labels = [
    { ...labelFile.labels[0]!, risk: 0, evidence: null },
    { ...labelFile.labels[1]!, risk: 1, evidence: null },
    { ...labelFile.labels[2]!, risk: 2, evidence: null },
    { ...labelFile.labels[3]!, risk: 3, evidence: null },
    { ...labelFile.labels[4]!, risk: 2 },
    { ...labelFile.labels[5]!, risk: 3 },
    { ...labelFile.labels[6]!, risk: 3, evidence: 'Generated absent quote.' },
  ];
  try {
    await mkdir(workspace);
    const store = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { initial },
    );
    await store.close();
    await writeFile(file, JSON.stringify(labelFile));
    const input = JSON.parse(await readFile(file, 'utf8')) as LabelFile;
    // Expected counts come from the authored cases in the actual fixture file.
    // Labels 2/3 carry null; labels 0/1 are lower risk and must not count.
    const warned = input.labels.slice(2, 4);
    expect(warned.map((label) => [label.risk, label.evidence])).toEqual([
      [2, null],
      [3, null],
    ]);
    const warning = `${warned.length} labels at risk 2 or 3 have evidence set to null. Review those suggestions individually.`;
    const dropped = input.labels.slice(6).length;
    const warnings = [
      `Dropped evidence from ${dropped} labels because it was not a verbatim substring of the entry text.`,
      warning,
    ];
    const assertWarningPrivacy = (value: string) => {
      for (const label of input.labels) {
        expect(value).not.toContain(label.reason);
        if (label.evidence) expect(value).not.toContain(label.evidence);
      }
      for (const item of initial.items) expect(value).not.toContain(item.text);
      expect(value).not.toContain(file);
      expect(value).not.toContain(workspace);
    };
    // LL-002: this exact fixture-derived absence check must catch a planted leak.
    for (const leak of [
      initial.items[2]!.text,
      input.labels[2]!.reason,
      input.labels[4]!.evidence!,
      file,
    ])
      expect(() => assertWarningPrivacy(`${warning} ${leak}`)).toThrow();
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    for (const json of [true, false]) {
      const result = await invoke(
        ['labels', 'submit', file, '--workspace', workspace, '--dry-run'],
        json,
      );
      expect(result.code).toBe(0);
      if (json) {
        expect(result.result).toMatchObject({
          status: 'ok',
          data: { accepted: input.labels.length, dryRun: true },
          warnings,
        });
      }
      expect(result.capture.stderr.join('')).toBe(warnings.join('\n') + '\n');
      assertWarningPrivacy(
        json
          ? JSON.stringify((result.result as { warnings: string[] }).warnings)
          : result.capture.stderr.join(''),
      );
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
      ).toBe(true);
    }
    const submitted = await invoke([
      'labels',
      'submit',
      file,
      '--workspace',
      workspace,
    ]);
    expect(submitted.code).toBe(0);
    expect(submitted.result).toMatchObject({
      data: { accepted: input.labels.length, dryRun: false, duplicate: false },
      warnings,
    });
    const after = await readFile(join(workspace, 'socialprune.sqlite'));
    for (const dryRun of [true, false]) {
      const duplicate = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
        ...(dryRun ? ['--dry-run'] : []),
      ]);
      expect(duplicate.code).toBe(0);
      expect(duplicate.result).toMatchObject({
        data: { accepted: input.labels.length, duplicate: true, dryRun },
        warnings,
      });
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(after),
      ).toBe(true);
    }
    const recorded = await load(workspace);
    expect(recorded.assessments).toHaveLength(input.labels.length);
    expect(recorded.assessments[2]!.evidence).toBeNull();
    expect(recorded.assessments[3]!.evidence).toBeNull();
    expect(recorded.assessments[6]!.evidence).toBeNull();
    expect(recorded.decisionEvents).toEqual([]);
    expect(recorded.outcomeEvents).toEqual([]);
    const quotedOnly = {
      ...input,
      submissionId: 'quoted-and-low-risk',
      labels: [...input.labels.slice(0, 2), ...input.labels.slice(4, 6)],
    };
    await writeFile(file, JSON.stringify(quotedOnly));
    for (const dryRun of [true, false]) {
      const result = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
        ...(dryRun ? ['--dry-run'] : []),
      ]);
      expect(result.code).toBe(0);
      expect(result.result).toMatchObject({ warnings: [] });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('whole hand-built files reject every validation class before writes and cannot name a decision, outcome or human source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c4-validation-'));
  const workspace = join(directory, 'workspace');
  const file = join(directory, 'labels.json');
  const fixture = JSON.parse(await readFile(expected, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  const valid = labels(fixture.items);
  const first = valid.labels[0]!;
  // Every expected code/index below is authored with the invalid input, not
  // copied from the validator or computed by a production predicate (LL-002).
  const cases: {
    name: string;
    value: unknown;
    failures: { index: number; code: string }[];
  }[] = [
    {
      name: 'unknown item',
      value: { ...valid, labels: [first, { ...first, itemId: 'x:missing' }] },
      failures: [{ index: 1, code: 'UNKNOWN_ITEM' }],
    },
    {
      name: 'changed content',
      value: {
        ...valid,
        labels: [{ ...first, contentHash: `sha256:${'0'.repeat(64)}` }],
      },
      failures: [{ index: 0, code: 'CONTENT_CHANGED' }],
    },
    {
      name: 'unknown category',
      value: {
        ...valid,
        labels: [{ ...first, category: 'unlisted-category' }],
      },
      failures: [{ index: 0, code: 'UNKNOWN_CATEGORY' }],
    },
    {
      name: 'two sentences',
      value: {
        ...valid,
        labels: [{ ...first, reason: 'First sentence. Second sentence.' }],
      },
      failures: [{ index: 0, code: 'INVALID_REASON' }],
    },
    {
      name: 'reason too long',
      value: { ...valid, labels: [{ ...first, reason: 'a'.repeat(301) }] },
      failures: [{ index: 0, code: 'INVALID_REASON' }],
    },
    {
      name: 'blank reason',
      value: { ...valid, labels: [{ ...first, reason: ' ' }] },
      failures: [{ index: 0, code: 'INVALID_REASON' }],
    },
    {
      name: 'line in reason',
      value: { ...valid, labels: [{ ...first, reason: 'First\nsecond' }] },
      failures: [{ index: 0, code: 'INVALID_REASON' }],
    },
    {
      name: 'risk range',
      value: { ...valid, labels: [{ ...first, risk: 4 }] },
      failures: [{ index: 0, code: 'INVALID_LABEL' }],
    },
    {
      name: 'risk integer',
      value: { ...valid, labels: [{ ...first, risk: 0.5 }] },
      failures: [{ index: 0, code: 'INVALID_LABEL' }],
    },
    {
      name: 'confidence range',
      value: { ...valid, labels: [{ ...first, confidence: 2 }] },
      failures: [{ index: 0, code: 'INVALID_LABEL' }],
    },
    {
      name: 'decision field',
      value: { ...valid, labels: [{ ...first, decision: 'delete' }] },
      failures: [{ index: 0, code: 'INVALID_LABEL' }],
    },
    {
      name: 'outcome field',
      value: { ...valid, labels: [{ ...first, outcome: 'deleted-by-user' }] },
      failures: [{ index: 0, code: 'INVALID_LABEL' }],
    },
    {
      name: 'human source',
      value: { ...valid, source: { ...valid.source, kind: 'human' } },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'fixture source',
      value: { ...valid, source: { ...valid.source, kind: 'fixture' } },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'source via',
      value: { ...valid, source: { ...valid.source, via: 'local-review' } },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'file decision',
      value: { ...valid, decision: 'delete' },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'file outcome',
      value: { ...valid, outcome: 'skipped' },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'submission ID',
      value: { ...valid, submissionId: 'invalid/id' },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'submission ID too long',
      value: { ...valid, submissionId: 'a'.repeat(129) },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'file version',
      value: { ...valid, schemaVersion: 2 },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'too many labels',
      value: { ...valid, labels: Array.from({ length: 1001 }, () => first) },
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    },
    {
      name: 'duplicate item',
      value: { ...valid, labels: [first, first] },
      failures: [{ index: 1, code: 'INVALID_LABEL' }],
    },
  ];
  try {
    expect(
      (await invoke(['import', archive, '--workspace', workspace])).code,
    ).toBe(0);
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    for (const invalid of cases) {
      await writeFile(file, JSON.stringify(invalid.value));
      const result = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
      ]);
      expect(result.code, invalid.name).toBe(1);
      expect(result.result, invalid.name).toMatchObject({
        error: {
          code: 'INVALID_LABELS',
          exitCode: 1,
          retryable: false,
          details: { failures: invalid.failures },
        },
      });
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
        invalid.name,
      ).toBe(true);
      expect(await readdir(workspace)).toEqual(['socialprune.sqlite']);
    }
    await writeFile(file, '{not JSON');
    expect(
      (await invoke(['labels', 'submit', file, '--workspace', workspace]))
        .result,
    ).toMatchObject({
      error: {
        code: 'INVALID_LABELS',
        details: { failures: [{ index: -1, code: 'INVALID_LABEL' }] },
      },
    });
    for (const args of [
      ['labels', 'submit', '--workspace', workspace],
      ['labels', 'submit', file, '--workspace', workspace, '--approve'],
      [
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
        '--source-kind',
        'human',
      ],
    ])
      expect((await invoke(args)).code).toBe(2);
    expect(
      (
        await invoke([
          'labels',
          'submit',
          join(directory, 'absent.json'),
          '--workspace',
          workspace,
        ])
      ).result,
    ).toMatchObject({ error: { code: 'IO_ERROR' } });
    expect(
      (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
    ).toBe(true);
    const data = await load(workspace);
    expect(data.assessments).toEqual([]);
    expect(data.submissions).toEqual([]);
    expect(data.decisionEvents).toEqual([]);
    expect(data.outcomeEvents).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test('whole-file failures use -1 while label 0 and label 3 retain their actual positions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c4-indexes-'));
  const workspace = join(directory, 'workspace');
  const file = join(directory, 'labels.json');
  const fixture = JSON.parse(await readFile(expected, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  const initial = createWorkspace();
  initial.items = Array.from({ length: 4 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:generated-index-${index}`,
  }));
  initial.imports = [
    {
      id: 'generated-index-import',
      platform: 'x',
      archives: [initial.items[0]!.provenance.archive],
      accounts: [initial.items[0]!.account],
      importedAt: initial.createdAt,
      exportCreatedAt: initial.createdAt,
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 4,
      status: 'complete',
    },
  ];
  initial.counts.items = 4;
  initial.counts.imports = 1;
  const valid = labels(initial.items);
  const first = valid.labels[0]!;
  const cases = [
    {
      name: '1001-label file',
      value: { ...valid, labels: Array.from({ length: 1001 }, () => first) },
      index: -1,
      code: 'INVALID_LABEL',
    },
    {
      name: 'file version',
      value: { ...valid, schemaVersion: 2 },
      index: -1,
      code: 'INVALID_LABEL',
    },
    {
      name: 'file source',
      value: { ...valid, source: { ...valid.source, kind: 'human' } },
      index: -1,
      code: 'INVALID_LABEL',
    },
    {
      name: 'label zero',
      value: {
        ...valid,
        labels: [{ ...first, category: 'invented-unknown-category' }],
      },
      index: 0,
      code: 'UNKNOWN_CATEGORY',
    },
    {
      name: 'label three',
      value: {
        ...valid,
        labels: valid.labels.map((label, index) =>
          index === 3
            ? { ...label, category: 'invented-unknown-category' }
            : label,
        ),
      },
      index: 3,
      code: 'UNKNOWN_CATEGORY',
    },
  ];
  try {
    await mkdir(workspace);
    const store = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { initial },
    );
    await store.close();
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    for (const input of cases) {
      await writeFile(file, JSON.stringify(input.value));
      const result = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
      ]);
      expect(result.code, input.name).toBe(1);
      expect(result.result, input.name).toMatchObject({
        error: {
          code: 'INVALID_LABELS',
          details: { failures: [{ index: input.index, code: input.code }] },
        },
      });
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
      ).toBe(true);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dry-run and duplicate preserve bytes, dropped evidence warns, canonical replay survives restore and conflicts write nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c4-submit-'));
  const workspace = join(directory, 'workspace');
  const restored = join(directory, 'restored');
  const file = join(directory, 'labels.json');
  const backup = join(directory, 'backup.json');
  const fixture = JSON.parse(await readFile(expected, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  const valid = labels(fixture.items);
  valid.labels[0]!.evidence = 'Invented evidence absent from the fixture.';
  try {
    expect(
      (await invoke(['import', archive, '--workspace', workspace])).code,
    ).toBe(0);
    await writeFile(file, JSON.stringify(valid));
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    const dry = await invoke([
      'labels',
      'submit',
      file,
      '--workspace',
      workspace,
      '--dry-run',
    ]);
    expect(dry.code).toBe(0);
    expect(dry.result).toMatchObject({
      data: {
        accepted: fixture.items.length,
        duplicate: false,
        dryRun: true,
        droppedEvidence: 1,
      },
      warnings: [
        'Dropped evidence from 1 labels because it was not a verbatim substring of the entry text.',
      ],
    });
    expect(
      (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
    ).toBe(true);
    const committed = await invoke([
      'labels',
      'submit',
      file,
      '--workspace',
      workspace,
    ]);
    expect(committed.code).toBe(0);
    if (committed.result?.status === 'error')
      throw new Error('Expected submission.');
    const receipt = LabelSubmissionSchema.parse(committed.result?.data);
    expect(receipt).toMatchObject({
      accepted: fixture.items.length,
      duplicate: false,
      dryRun: false,
      droppedEvidence: 1,
    });
    const after = await readFile(join(workspace, 'socialprune.sqlite'));
    const snapshot = await load(workspace);
    expect(snapshot.submissions).toHaveLength(1);
    expect(snapshot.submissions[0]).toMatchObject({
      submissionId: valid.submissionId,
      source: valid.source,
      labelCount: fixture.items.length,
    });
    expect(snapshot.assessments).toHaveLength(fixture.items.length);
    expect(snapshot.assessments[0]!.evidence).toBeNull();
    expect(
      snapshot.assessments.every(
        (assessment) =>
          assessment.assessmentId &&
          assessment.submissionId === valid.submissionId &&
          assessment.source.kind === 'agent',
      ),
    ).toBe(true);
    // Property order and whitespace do not change the canonical content hash.
    await writeFile(
      file,
      JSON.stringify(
        {
          labels: valid.labels,
          source: valid.source,
          submissionId: valid.submissionId,
          schemaVersion: 1,
        },
        null,
        2,
      ),
    );
    for (const flags of [[], ['--dry-run']]) {
      const duplicate = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
        ...flags,
      ]);
      expect(duplicate.code).toBe(0);
      expect(duplicate.result).toMatchObject({
        data: { ...receipt, duplicate: true, dryRun: flags.length > 0 },
      });
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(after),
      ).toBe(true);
    }
    const humanDuplicate = await invoke(
      ['labels', 'submit', file, '--workspace', workspace],
      false,
    );
    expect(humanDuplicate.code).toBe(0);
    expect(humanDuplicate.capture.stdout.join('')).toBe(
      `Submission already recorded. ${fixture.items.length} suggestions; nothing written.\n`,
    );
    expect(humanDuplicate.capture.stderr.join('')).toBe(
      'Dropped evidence from 1 labels because it was not a verbatim substring of the entry text.\n',
    );
    expect(
      (await readFile(join(workspace, 'socialprune.sqlite'))).equals(after),
    ).toBe(true);
    const conflict = {
      ...valid,
      labels: [
        { ...valid.labels[0]!, reason: 'A different generated reason.' },
      ],
    };
    await writeFile(file, JSON.stringify(conflict));
    expect(
      (await invoke(['labels', 'submit', file, '--workspace', workspace]))
        .result,
    ).toMatchObject({ error: { code: 'SUBMISSION_CONFLICT' } });
    expect(
      (await readFile(join(workspace, 'socialprune.sqlite'))).equals(after),
    ).toBe(true);
    expect(
      (
        await invoke([
          'backup',
          'export',
          '--workspace',
          workspace,
          '--out',
          backup,
        ])
      ).code,
    ).toBe(0);
    expect(
      (await invoke(['backup', 'restore', backup, '--workspace', restored]))
        .code,
    ).toBe(0);
    await writeFile(file, JSON.stringify(valid));
    const restoredBefore = await readFile(join(restored, 'socialprune.sqlite'));
    expect(
      (await invoke(['labels', 'submit', file, '--workspace', restored]))
        .result,
    ).toMatchObject({
      data: { duplicate: true, accepted: fixture.items.length },
    });
    expect(
      (await readFile(join(restored, 'socialprune.sqlite'))).equals(
        restoredBefore,
      ),
    ).toBe(true);
    expect(snapshot.decisionEvents).toEqual([]);
    expect(snapshot.outcomeEvents).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one 1000-label transaction rolls back the submission and every assessment on a planted SQLite failure', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-c4-transaction-'),
  );
  const workspace = join(directory, 'workspace');
  const file = join(directory, 'labels.json');
  const fixture = JSON.parse(await readFile(expected, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  const initial = createWorkspace();
  initial.items = Array.from({ length: 1000 }, (_, index) => ({
    ...fixture.items[0]!,
    id: `x:${index}`,
    text: `Invented entry ${index}.`,
  }));
  initial.imports = [
    {
      id: 'generated-1000',
      platform: 'x',
      archives: [initial.items[0]!.provenance.archive],
      accounts: [initial.items[0]!.account],
      importedAt: initial.createdAt,
      exportCreatedAt: initial.createdAt,
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 1000,
      status: 'complete',
    },
  ];
  initial.counts.items = 1000;
  initial.counts.imports = 1;
  try {
    await mkdir(workspace);
    const store = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { initial },
    );
    await store.close();
    await writeFile(file, JSON.stringify(labels(initial.items)));
    const maximumBatch = await invoke([
      'batch',
      'next',
      '--workspace',
      workspace,
      '--share-with-agent',
      '--size',
      '200',
    ]);
    expect(maximumBatch.code).toBe(0);
    expect(maximumBatch.result).toMatchObject({
      data: { shared: { count: 200 }, hasMore: true },
    });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(workspace, 'socialprune.sqlite'), {
      allowExtension: false,
    });
    // Test-owned trigger only, never an environment flag or production entry.
    db.exec(
      "CREATE TRIGGER generated_label_failure BEFORE INSERT ON assessments WHEN NEW.item_id='x:999' BEGIN SELECT RAISE(ABORT, 'generated rollback'); END;",
    );
    db.close();
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    let writes = 0;
    const write = Reflect.get(SQLiteStore.prototype, 'write');
    SQLiteStore.prototype.write = function <T>(
      operation: (tx: WriteTransaction) => Promise<T>,
    ): Promise<T> {
      writes++;
      return write.bind(this)(operation);
    };
    try {
      expect(
        (await invoke(['labels', 'submit', file, '--workspace', workspace]))
          .code,
      ).toBe(1);
      expect(writes).toBe(1);
      expect(
        (await readFile(join(workspace, 'socialprune.sqlite'))).equals(before),
      ).toBe(true);
      expect((await load(workspace)).submissions).toEqual([]);
      expect((await load(workspace)).assessments).toEqual([]);
      const repair = new DatabaseSync(join(workspace, 'socialprune.sqlite'), {
        allowExtension: false,
      });
      repair.exec('DROP TRIGGER generated_label_failure;');
      repair.close();
      writes = 0;
      const result = await invoke([
        'labels',
        'submit',
        file,
        '--workspace',
        workspace,
      ]);
      expect(result.code).toBe(0);
      expect(result.result).toMatchObject({ data: { accepted: 1000 } });
      expect(writes).toBe(1);
      const data = await load(workspace);
      expect(data.submissions).toHaveLength(1);
      expect(data.assessments).toHaveLength(1000);
      expect(data.decisionEvents).toEqual([]);
      expect(data.outcomeEvents).toEqual([]);
    } finally {
      SQLiteStore.prototype.write = write;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scripted demo import -> consented batches -> dry-run and submit -> summary -> duplicate makes suggestions but no decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c4-roundtrip-'));
  const workspace = join(directory, 'workspace');
  const file = join(directory, 'labels.json');
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', demo), 'utf8'),
  ) as {
    exports: {
      directory: string;
      account: { key: string };
      itemCount: number;
    }[];
  };
  const source = {
    kind: 'agent' as const,
    name: 'scripted-demo-agent',
    version: '1',
  };
  let submitted = 0;
  let lastFile: LabelFile | undefined;
  const seen = new Set<string>();
  try {
    const imported = await invoke([
      'import',
      ...manifest.exports.map((entry) =>
        fileURLToPath(new URL(entry.directory + '/', demo)),
      ),
      '--workspace',
      workspace,
    ]);
    expect(imported.code).toBe(0);
    expect(imported.result).toMatchObject({
      data: {
        added: manifest.exports.reduce(
          (sum, entry) => sum + entry.itemCount,
          0,
        ),
      },
    });
    for (const entry of manifest.exports) {
      let cursor: string | null = null;
      let hasMore: boolean;
      do {
        const batchReply = await invoke([
          'batch',
          'next',
          '--workspace',
          workspace,
          '--share-with-agent',
          '--account',
          entry.account.key,
          '--source-name',
          source.name,
          '--size',
          '50',
          ...(cursor ? ['--cursor', cursor] : []),
        ]);
        expect(batchReply.code).toBe(0);
        if (batchReply.result?.status === 'error')
          throw new Error('Expected batch.');
        const batch = BatchSchema.parse(batchReply.result?.data);
        expect(batch.categories).toContain('harmless');
        const labelFile: LabelFile = {
          schemaVersion: 1,
          submissionId: `scripted-demo-${submitted}`,
          source,
          labels: batch.items.map((item) => {
            expect(seen.has(item.itemId)).toBe(false);
            seen.add(item.itemId);
            return {
              itemId: item.itemId,
              contentHash: item.contentHash,
              category: 'harmless',
              risk: 0,
              reason: 'This invented entry is a scripted test example.',
              evidence: item.content.text.slice(0, 20),
              confidence: null,
            };
          }),
        };
        await writeFile(file, JSON.stringify(labelFile));
        const before = await readFile(join(workspace, 'socialprune.sqlite'));
        expect(
          (
            await invoke([
              'labels',
              'submit',
              file,
              '--workspace',
              workspace,
              '--dry-run',
            ])
          ).result,
        ).toMatchObject({
          data: {
            accepted: batch.items.length,
            dryRun: true,
            duplicate: false,
            droppedEvidence: 0,
          },
        });
        expect(
          (await readFile(join(workspace, 'socialprune.sqlite'))).equals(
            before,
          ),
        ).toBe(true);
        const result = await invoke([
          'labels',
          'submit',
          file,
          '--workspace',
          workspace,
        ]);
        expect(result.code).toBe(0);
        expect(result.result).toMatchObject({
          data: {
            accepted: batch.items.length,
            dryRun: false,
            duplicate: false,
          },
        });
        lastFile = labelFile;
        submitted++;
        hasMore = batch.hasMore;
        cursor = batch.nextCursor;
      } while (hasMore);
      const exhausted = await invoke([
        'batch',
        'next',
        '--workspace',
        workspace,
        '--share-with-agent',
        '--account',
        entry.account.key,
        '--source-name',
        source.name,
      ]);
      expect(exhausted.result).toMatchObject({
        data: { items: [], hasMore: false, shared: { count: 0 } },
      });
      expect(exhausted.capture.stderr.join('')).toContain('Sharing 0 entries');
      const emptyHuman = await invoke(
        [
          'batch',
          'next',
          '--workspace',
          workspace,
          '--share-with-agent',
          '--account',
          entry.account.key,
          '--source-name',
          source.name,
        ],
        false,
      );
      expect(emptyHuman.code).toBe(0);
      expect(emptyHuman.capture.stderr.join('')).toContain('Sharing 0 entries');
    }
    const summaryReply = await invoke(['summary', '--workspace', workspace]);
    if (summaryReply.result?.status === 'error')
      throw new Error('Expected summary.');
    const summary = SummarySchema.parse(summaryReply.result?.data);
    expect(summary).toMatchObject({
      withoutAgentAssessment: 0,
      assessments: [{ kind: 'agent', name: source.name, count: 420 }],
      counts: {
        items: 420,
        assessments: 420,
        submissions: submitted,
        decisionEvents: 0,
        outcomeEvents: 0,
      },
      decisions: { keep: 0, delete: 0, later: 0, undecided: 420 },
      decisionSources: [],
    });
    expect(seen.size).toBe(
      manifest.exports.reduce((sum, entry) => sum + entry.itemCount, 0),
    );
    await writeFile(file, JSON.stringify(lastFile));
    const beforeReplay = await readFile(join(workspace, 'socialprune.sqlite'));
    expect(
      (await invoke(['labels', 'submit', file, '--workspace', workspace]))
        .result,
    ).toMatchObject({ data: { duplicate: true } });
    expect(
      (await readFile(join(workspace, 'socialprune.sqlite'))).equals(
        beforeReplay,
      ),
    ).toBe(true);
    const data = await load(workspace);
    for (const item of data.items)
      if (item.text)
        expect(summaryReply.capture.stdout.join('')).not.toContain(item.text);
    expect(data.decisionEvents).toEqual([]);
    expect(data.outcomeEvents).toEqual([]);
    // A different source name still receives those entries; no lease was made.
    expect(
      (
        await invoke([
          'batch',
          'next',
          '--workspace',
          workspace,
          '--share-with-agent',
          '--account',
          manifest.exports[0]!.account.key,
          '--source-name',
          'different-agent',
        ])
      ).result,
    ).toMatchObject({ data: { shared: { count: 50 } } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
