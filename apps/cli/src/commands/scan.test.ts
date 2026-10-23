/* eslint-disable no-restricted-properties -- Test-only environment canary proves production ignores ambient keys. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { scanFixture } from './scan-fixture.test-support.ts';

test('foundation: real CLI dry-run, check, confirmed run, SQLite submission and resume with no decisions', async () => {
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
    expect(result.stderr).toContain('1 entries: platform, kind and full text');
    expect(result.stderr).not.toContain('Generated contract input.');
    const again = await h.invoke(args);
    expect(again.code).toBe(0);
    expect(h.requests).toHaveLength(3);
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
test('the sharing notice precedes the first real request and the fifty-entry canary is counted in entries', async () => {
  const observed: string[] = [];
  const h = await scanFixture({
    entries: 60,
    observe: (stderr) => observed.push(stderr),
  });
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
    const run = await h.invoke([...args, '--limit', '50']);
    expect(run.code, run.stdout).toBe(0);
    expect(run.data.data).toMatchObject({
      entries: { checked: 50 },
      requests: { sent: 2 },
    });
    for (const notice of observed) {
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
  const h = await scanFixture({ errorStatus: 401 });
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
        entries: { checked: 0, remaining: 1 },
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
    observe: () => {
      if (!sent) {
        sent = true;
        process.emit('SIGINT');
      }
    },
  });
  try {
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
      entries: { checked: 0 },
      requests: { sent: 1 },
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
    expect(stale.data.error?.code).toBe('STALE_PLAN');
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
    expect(h.requests).toHaveLength(0);
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
    expect(h.requests).toHaveLength(0);
  } finally {
    await h.close();
  }
});
