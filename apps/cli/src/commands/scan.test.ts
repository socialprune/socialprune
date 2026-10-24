/* eslint-disable no-restricted-properties -- Test-only environment canary proves production ignores ambient keys. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { scanFixture } from './scan-fixture.test-support.ts';
import { commandRegistry } from '../cli/registry.ts';

test('scan check declares that it writes the explicitly named source file', () => {
  expect(
    commandRegistry().find((entry) => entry.path.join('.') === 'scan.check'),
  ).toMatchObject({ writes: true, dryRun: false });
});

test('R6 no recorded check or mismatching confirmation refuses before any request', async () => {
  const h = await scanFixture();
  try {
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const args = [
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ];
    const noCheck = await h.invoke(args);
    expect(noCheck.code).toBe(2);
    expect(noCheck.data.error?.code).toBe('ENDPOINT_NOT_CONFIRMED');
    expect(h.requests).toHaveLength(0);
    expect(noCheck.stderr).toContain('scan check');
    expect(noCheck.stderr).toContain('no recorded check');
    await h.invoke(['scan', 'check', '--source', h.source]);
    const before = h.requests.length;
    args[args.indexOf('--confirm-model') + 1] = 'generated-wrong-model';
    const mismatch = await h.invoke(args);
    expect(mismatch.data.error?.code).toBe('ENDPOINT_NOT_CONFIRMED');
    expect(h.requests).toHaveLength(before);
    expect(mismatch.stderr).toContain('generated-model');
    expect(mismatch.stderr).toContain('generated-wrong-model');
  } finally {
    await h.close();
  }
});
test('R6 changed recorded check makes the old plan stale without a run request', async () => {
  let model = 'generated-model';
  const h = await scanFixture({ answeringModel: () => model });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    const stored = JSON.parse(await readFile(h.source, 'utf8')) as {
      check?: {
        answeringModel: string;
        rubricVersion: string;
        checkedAt: string;
      };
    };
    expect(stored.check).toMatchObject({ answeringModel: 'generated-model' });
    expect(stored.check?.checkedAt).toMatch(/^\d{4}-/);
    expect(stored.check?.rubricVersion).toHaveLength(12);
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    model = 'generated-model-2';
    await h.invoke(['scan', 'check', '--source', h.source]);
    const before = h.requests.length;
    const result = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      model,
    ]);
    expect(result.data.error?.code).toBe('STALE_PLAN');
    expect(h.requests).toHaveLength(before);
  } finally {
    await h.close();
  }
});

test('R2 reports observed and confirmed model separately when live model changes after recorded check', async () => {
  let model = 'generated-wrong-model';
  const h = await scanFixture({ answeringModel: () => model });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    model = 'generated-model';
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const args = [
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-wrong-model',
    ];
    const result = await h.invoke(args);
    expect(result.data.data).toMatchObject({
      source: {
        confirmedModel: 'generated-wrong-model',
        answeringModel: 'generated-model',
      },
      stopDetail: 'MODEL_CHANGED',
    });
    const human = await h.invoke(args, undefined, false);
    expect(human.stdout).toContain(
      'The endpoint answered as generated-model; you confirmed generated-wrong-model. Nothing was stored.',
    );
  } finally {
    await h.close();
  }
});
test('R4 sends before an answer and prints token figures only after they are reported', async () => {
  const notices: string[] = [];
  const h = await scanFixture({ observe: (text) => notices.push(text) });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    notices.length = 0;
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const result = await h.invoke(
      [
        'scan',
        'run',
        '--workspace',
        h.workspace,
        '--source',
        h.source,
        '--plan',
        preview.data.data!.plan as string,
        '--confirm-endpoint',
        h.origin,
        '--confirm-model',
        'generated-model',
      ],
      undefined,
      false,
    );
    expect(result.code).toBe(0);
    expect(notices[0]).toContain('Sending model check: 1 invented entry');
    expect(notices[0]).not.toContain('Tokens:');
    expect(notices.at(-1)).toContain('Sending request 1 of 1; batch 1.');
    const beforeAnswer = notices
      .at(-1)!
      .split('Sending request 1 of 1; batch 1.')[1]!;
    expect(beforeAnswer).not.toContain('Stored');
    expect(beforeAnswer).not.toContain('Tokens:');
  } finally {
    await h.close();
  }
});
test('R5 a wrong confirmed model stops before coverage counts or workspace text are sent again', async () => {
  const h = await scanFixture({ entries: 5 });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const args = [
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ];
    expect((await h.invoke(args)).code).toBe(0);
    const before = h.requests.length;
    args[args.indexOf('--confirm-model') + 1] = 'generated-wrong-model';
    const stopped = await h.invoke(args);
    expect(stopped.data.error?.code).toBe('ENDPOINT_NOT_CONFIRMED');
    expect(h.requests.slice(before)).toHaveLength(0);
  } finally {
    await h.close();
  }
});

test('foundation: real CLI dry-run, check, confirmed run, SQLite submission and resume with no decisions', async () => {
  const h = await scanFixture();
  try {
    let preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    expect(preview.code).toBe(0);
    expect(preview.data.data).toMatchObject({
      entries: { alreadyDecided: 0, checkedElsewhere: 0 },
      criteria: { political: 1 },
    });
    expect(h.requests).toHaveLength(0);
    const check = await h.invoke(['scan', 'check', '--source', h.source]);
    expect(check.code).toBe(0);
    expect(check.data.data).toMatchObject({
      modelListed: true,
      answeringModel: 'generated-model',
      structuredOutput: true,
    });
    expect(h.requests).toHaveLength(2);
    preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const args = [
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ];
    const result = await h.invoke(args);
    expect(result.code, result.stdout).toBe(0);
    expect(result.data.data).toMatchObject({
      entries: { checked: 1, remaining: 0 },
      requests: { sent: 1 },
    });
    expect(result.stderr).toContain('1 entry: platform, kind and full text');
    expect(result.stderr).not.toContain('Generated contract input.');
    const again = await h.invoke(args);
    expect(again.code).toBe(0);
    expect(h.requests).toHaveLength(5);
    const store = await SQLiteStore.open(
      join(h.workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      const saved = await store.read(readWorkspace);
      expect(saved.assessments).toHaveLength(1);
      expect(saved.assessments[0]?.source.kind).toBe('model');
      expect(saved.decisionEvents).toEqual([]);
    } finally {
      await store.close();
    }
  } finally {
    await h.close();
  }
});
test('human output uses named lines, marks a dry run before the sharing notice and keeps JSON unchanged', async () => {
  const h = await scanFixture();
  try {
    const check = await h.invoke(
      ['scan', 'check', '--source', h.source],
      undefined,
      false,
    );
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('Endpoint check:');
    expect(check.stdout).toContain('Structured answer: accepted');
    expect(check.stdout).not.toMatch(/^\{/m);
    expect(check.stderr).toContain(
      'One invented entry and preset criteria; nothing from your workspace is sent.',
    );
    expect(check.stderr).not.toContain("Your entries' text");
    const preview = await h.invoke(
      [
        'scan',
        'run',
        '--workspace',
        h.workspace,
        '--source',
        h.source,
        '--dry-run',
      ],
      undefined,
      false,
    );
    expect(preview.stdout).toContain(
      'Dry-run plan. No request was sent or suggestion written.',
    );
    expect(preview.stdout).not.toMatch(/^\{/m);
    expect(preview.stderr.indexOf('Dry run: no request')).toBe(0);
    const plan = preview.stdout.match(/^Plan: (sha256:[a-f0-9]+)$/m)![1]!;
    const run = await h.invoke(
      [
        'scan',
        'run',
        '--workspace',
        h.workspace,
        '--source',
        h.source,
        '--plan',
        plan,
        '--confirm-endpoint',
        h.origin,
        '--confirm-model',
        'generated-model',
        '--limit',
        '1',
      ],
      undefined,
      false,
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Suggestions stored: 1; entries remaining: 0');
    expect(run.stderr).toContain('Stored 1; remaining 0; requests 1');
    expect(run.stdout + run.stderr).not.toMatch(/^\{/m);
    const json = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    expect(json.data.data).toMatchObject({
      dryRun: true,
      entries: { planned: 0 },
    });
  } finally {
    await h.close();
  }
});
test('the sharing notice precedes the first real request and the fifty-entry canary is counted in entries', async () => {
  const observed: string[] = [];
  const h = await scanFixture({
    entries: 60,
    observe: (stderr) => observed.push(stderr),
  });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    observed.length = 0;
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const args = [
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ];
    const run = await h.invoke([...args, '--limit', '50']);
    expect(run.code, run.stdout).toBe(0);
    expect(run.data.data).toMatchObject({
      entries: { checked: 50 },
      requests: { sent: 2 },
    });
    expect(observed[0]).toContain('One invented entry and preset criteria');
    for (const notice of observed.slice(1)) {
      expect(notice).toContain('50 entries: platform, kind and full text');
      expect(notice).toContain(h.origin);
      expect(notice).toContain('Without a key.');
    }
    const resume = await h.invoke(args);
    expect(resume.code).toBe(0);
    expect(resume.data.data).toMatchObject({
      entries: { checked: 10, skipped: { currentSource: 50 } },
    });
  } finally {
    await h.close();
  }
});
test('a redirect is refused without contacting a second origin', async () => {
  const foreign = await scanFixture();
  const h = await scanFixture({ redirect: foreign.origin });
  try {
    const check = await h.invoke(['scan', 'check', '--source', h.source]);
    expect(check.data.error?.code).toBe('REDIRECT_REFUSED');
    expect(foreign.requests).toHaveLength(0);
  } finally {
    await h.close();
    await foreign.close();
  }
});
test('endpoint refusal returns a bounded final report and leaves no suggestion or decision', async () => {
  const h = await scanFixture({
    errorStatus: 401,
    delayErrorsUntilChecked: true,
  });
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    const result = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ]);
    expect(result.code).toBe(1);
    expect(result.data).toMatchObject({
      status: 'partial',
      data: {
        stopDetail: 'ENDPOINT_UNAUTHORIZED',
        coverageCounted: false,
        entries: null,
        source: { answeringModel: null, confirmedModel: 'generated-model' },
        requests: { failed: 1 },
      },
    });
    expect(result.stdout + result.stderr).not.toContain(
      'Generated forbidden echo',
    );
    const store = await SQLiteStore.open(
      join(h.workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      const saved = await store.read(readWorkspace);
      expect(saved.assessments).toEqual([]);
      expect(saved.decisionEvents).toEqual([]);
    } finally {
      await store.close();
    }
  } finally {
    await h.close();
  }
});
test('explicit source ignores ambient key canaries and Ctrl+C settles with no decision', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'C2_ENV_KEY_CANARY';
  const h = await scanFixture();
  try {
    const check = await h.invoke(['scan', 'check', '--source', h.source]);
    expect(check.code).toBe(0);
    expect(h.requests.every((r) => r.authorization === undefined)).toBe(true);
    expect(
      check.stdout + check.stderr + JSON.stringify(h.requests),
    ).not.toContain('C2_ENV_KEY_CANARY');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    await h.close();
  }
  let sent = false;
  const stopped = await scanFixture({
    delayErrorsUntilChecked: true,
    observe: () => {
      if (!sent) {
        sent = true;
        process.emit('SIGINT');
      }
    },
  });
  try {
    await stopped.invoke(['scan', 'check', '--source', stopped.source]);
    const preview = await stopped.invoke([
      'scan',
      'run',
      '--workspace',
      stopped.workspace,
      '--source',
      stopped.source,
      '--dry-run',
    ]);
    const result = await stopped.invoke([
      'scan',
      'run',
      '--workspace',
      stopped.workspace,
      '--source',
      stopped.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      stopped.origin,
      '--confirm-model',
      'generated-model',
    ]);
    expect(result.code).toBe(1);
    expect(result.data.data).toMatchObject({
      stopDetail: 'RUN_STOPPED',
      coverageCounted: false,
      entries: null,
      requests: { sent: 0 },
      modelCheck: { sent: 1 },
    });
  } finally {
    await stopped.close();
  }
});
test('no source or confirmation means no network; changed source invalidates a plan before network', async () => {
  const h = await scanFixture();
  try {
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    for (const args of [
      ['scan', 'check'],
      ['scan', 'check', '--source', join(h.directory, 'missing.json')],
      ['scan', 'run', '--workspace', h.workspace, '--source', h.source],
      [
        'scan',
        'run',
        '--workspace',
        h.workspace,
        '--source',
        h.source,
        '--plan',
        preview.data.data!.plan as string,
        '--confirm-endpoint',
        'http://127.0.0.1:1',
        '--confirm-model',
        'generated-model',
      ],
    ])
      expect((await h.invoke(args)).code).toBe(2);
    expect(h.requests).toHaveLength(0);
    const config = JSON.parse(await readFile(h.source, 'utf8')) as Record<
      string,
      unknown
    >;
    config.parallelRequests = 2;
    await writeFile(h.source, JSON.stringify(config));
    const stale = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ]);
    expect(stale.data.error?.code).toBe('ENDPOINT_NOT_CONFIRMED');
    expect(h.requests).toHaveLength(0);
  } finally {
    await h.close();
  }
});
test('source setup is exclusive, outside Git, never reads the named key, and makes no request', async () => {
  const h = await scanFixture();
  try {
    const out = join(h.directory, 'new-source.json');
    const recorder = networkRecorder();
    try {
      const result = await h.invoke([
        'scan',
        'source',
        '--out',
        out,
        '--base-url',
        h.origin + '/v1',
        '--model',
        'generated-model',
        '--entries-per-request',
        '25',
        '--key-file',
        'not-created.key',
      ]);
      expect(result.code, result.stdout).toBe(0);
      expect(recorder.calls).toEqual([]);
      expect(
        (
          await h.invoke([
            'scan',
            'source',
            '--out',
            out,
            '--base-url',
            h.origin + '/v1',
            '--model',
            'generated-model',
            '--entries-per-request',
            '25',
          ])
        ).data.error?.code,
      ).toBe('SOURCE_PATH_REFUSED');
      await mkdir(join(h.directory, '.git'));
      expect(
        (
          await h.invoke([
            'scan',
            'source',
            '--out',
            join(h.directory, 'refused.json'),
            '--base-url',
            h.origin + '/v1',
            '--model',
            'generated-model',
            '--entries-per-request',
            '25',
          ])
        ).data.error?.code,
      ).toBe('SOURCE_PATH_REFUSED');
    } finally {
      recorder.restore();
    }
  } finally {
    await h.close();
  }
});
test('dry-run never opens the named key and a criteria edit invalidates the plan without network', async () => {
  const h = await scanFixture();
  try {
    await h.invoke(['scan', 'check', '--source', h.source]);
    const config = JSON.parse(await readFile(h.source, 'utf8')) as Record<
      string,
      unknown
    >;
    config.keyFile = 'does-not-exist.key';
    await writeFile(h.source, JSON.stringify(config));
    const preview = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--dry-run',
    ]);
    expect(preview.code).toBe(0);
    expect(h.requests).toHaveLength(2);
    delete config.keyFile;
    await writeFile(h.source, JSON.stringify(config));
    const store = await SQLiteStore.open(
      join(h.workspace, 'socialprune.sqlite'),
    );
    try {
      await store.write(async (tx) => {
        const meta = await tx.meta.get();
        meta.settings.criteria!.selected = ['toxic'];
        await tx.meta.set(meta);
      });
    } finally {
      await store.close();
    }
    const result = await h.invoke([
      'scan',
      'run',
      '--workspace',
      h.workspace,
      '--source',
      h.source,
      '--plan',
      preview.data.data!.plan as string,
      '--confirm-endpoint',
      h.origin,
      '--confirm-model',
      'generated-model',
    ]);
    expect(result.data.error?.code).toBe('STALE_PLAN');
    expect(h.requests).toHaveLength(2);
  } finally {
    await h.close();
  }
});
