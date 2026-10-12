import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { FIXTURE, fixtureWorkspace } from '../../e2e/fake-x/fixture.ts';
import { planDeletion, planText } from './plan.ts';
import { productionPace, dateInZone } from './pace.ts';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { BROWSER_WARNING } from './copy.ts';
import { OutcomeEventSchema, OutcomeValueSchema } from '@socialprune/core';
import { X_ALLOWED_HOSTS, X_ORIGIN, statusUrl } from './x/driver.ts';
import { startConfirmation } from './confirmation.ts';
import { createProfile, validateProfile, profileSnapshot } from './profile.ts';
import ts from 'typescript';
import { request } from 'node:http';

test('dry-run lists independent fixture decisions, origins and zero mutations/network', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-delete-plan-'));
  const db = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(db, { initial: fixtureWorkspace() });
  await store.close();
  const digest = async () =>
    createHash('sha256')
      .update(await readFile(db))
      .digest('hex');
  const before = await digest();
  const recorder = networkRecorder();
  try {
    const stdout: string[] = [],
      stderr: string[] = [];
    const context = createNodeContext(
      { write: (text) => stdout.push(text) },
      { write: (text) => stderr.push(text) },
    );
    expect(
      await executeCli(
        [
          'delete',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--dry-run',
          '--json',
        ],
        context,
      ),
    ).toBe(0);
    const envelope = JSON.parse(stdout.join('')) as {
      data: { planned: number; bulk: number };
    };
    expect(envelope.data).toMatchObject({
      planned: FIXTURE.expected.plannedIds.length,
      bulk: FIXTURE.expected.bulk,
    });
    expect(stdout.join('')).not.toContain(FIXTURE.rows[0].text.split('\n')[0]);
    const readonly = await SQLiteStore.open(db, { readOnly: true });
    const plan = await planDeletion(readonly, FIXTURE.account.key);
    expect(plan.rows.map((row) => row.item.id)).toEqual(
      FIXTURE.expected.plannedIds,
    );
    const text = planText(plan);
    expect(text).toContain('local-review\tsingle');
    expect(text).toContain('web-review\tbulk');
    for (const row of FIXTURE.rows.filter((row) =>
      FIXTURE.expected.plannedIds.some((id) => id === `x:${row.id}`),
    ))
      expect(text).toContain(row.text.split('\n')[0]);
    expect((await readonly.browserJournal()).runs).toEqual([]);
    await readonly.close();
    expect(await digest()).toBe(before);
    expect(await readdir(directory)).toEqual(['socialprune.sqlite']);
    expect(recorder.calls).toEqual([]);
    stdout.length = 0;
    expect(
      await executeCli(
        [
          'delete',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--profile',
          'decoy-profile',
          '--plan',
          'decoy',
        ],
        context,
      ),
    ).toBe(2);
    expect(stderr.join('')).toContain('own terminal');
  } finally {
    recorder.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test('production pace floor and cap cannot be lowered through injected option values', () => {
  expect(productionPace('delete')).toEqual({
    intervalMs: 30000,
    batchSize: 20,
    pauseMs: 900000,
    perDay: 200,
  });
  expect(productionPace('verify')).toEqual({
    intervalMs: 10000,
    batchSize: 100,
    pauseMs: 0,
    perDay: 100,
  });
  for (const options of [
    { intervalMs: 29999 },
    { batchSize: 21 },
    { pauseMs: 899999 },
    { perDay: 201 },
    { perDay: 0 },
    { intervalMs: NaN },
  ])
    expect(() => productionPace('delete', options)).toThrow();
  expect(
    productionPace('delete', { perDay: 1, intervalMs: 31000 }),
  ).toMatchObject({ perDay: 1, intervalMs: 31000 });
  expect(dateInZone('2026-10-11T22:30:00.000Z', 'Europe/Berlin')).toBe(
    '2026-10-12',
  );
});

test('minimal enum and browser via hunk retain decision boundary', () => {
  expect(OutcomeValueSchema.parse('deleted-via-browser')).toBe(
    'deleted-via-browser',
  );
  const event = {
    eventId: 'generated-outcome',
    seq: 1,
    itemId: 'x:1001',
    value: 'deleted-via-browser',
    previous: 'unknown',
    recordedAt: FIXTURE.now,
    source: { kind: 'human', via: 'browser-x' },
    action: { id: 'generated-attempt', kind: 'single', size: 1, reverts: null },
  };
  expect(OutcomeEventSchema.parse(event)).toEqual(event);
  expect(
    OutcomeEventSchema.safeParse({
      ...event,
      source: { kind: 'agent', via: 'browser-x' },
    }).success,
  ).toBe(false);
});

test('warning text is exactly the prescribed bilingual warning; pinned URLs never use item URLs', async () => {
  const authority = await readFile(
    fileURLToPath(
      new URL(
        '../../../../docs/architecture/adrs/ADR-023-acting-in-own-account.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  for (const text of Object.values(BROWSER_WARNING))
    expect(authority).toContain(`> ${text}`);
  expect(X_ORIGIN).toBe('https://x.com');
  expect(X_ALLOWED_HOSTS).toEqual([
    'x.com',
    'api.x.com',
    'abs.twimg.com',
    'pbs.twimg.com',
    'video.twimg.com',
  ]);
  expect(statusUrl('1001')).toBe('https://x.com/i/web/status/1001');
  for (const id of ['https://example.org', '../1001', '1001?query=1'])
    expect(() => statusUrl(id)).toThrow();
});

test('confirmation guards reject hostile decoys and replay without changing the start state', async () => {
  const server = await startConfirmation(
    {
      phase: 'start',
      warning: BROWSER_WARNING.en,
      profileWarning: 'Generated profile',
      planned: 1,
      bulk: 0,
      estimateMs: 0,
      list: 'fixture',
      rows: [],
      completed: 0,
      result: '',
    },
    4233,
  );
  const origin = new URL(server.url).origin,
    host = new URL(server.url).host;
  const send = (path: string, headers: Record<string, string>, body = '{}') =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve) => {
      const req = request(
        server.url + path.replace(/^\//, ''),
        {
          method: 'POST',
          headers: {
            Host: host,
            Origin: origin,
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (part: Buffer) => (data += part.toString()));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: data,
            }),
          );
        },
      );
      req.end(body);
    });
  try {
    const token = server.launchUrl.split('#bootstrap=')[1]!;
    const hostileHeaders: Record<string, string>[] = [
      { Host: 'localhost:4233' },
      { Host: host + '.decoy' },
      { Origin: 'http://127.0.0.1:4239' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of hostileHeaders) {
      const response = await send('/session', {
        'X-SocialPrune-Bootstrap': token,
        ...headers,
      });
      expect(response.status).toBe(403);
      expect(
        Object.keys(response.headers).some((key) =>
          key.startsWith('access-control'),
        ),
      ).toBe(false);
    }
    expect(
      (
        await send('/session', {
          'X-SocialPrune-Bootstrap': token,
          'Content-Type': 'text/plain',
        })
      ).status,
    ).toBe(415);
    const response = await send('/session', {
      'X-SocialPrune-Bootstrap': token,
    });
    expect(response.status).toBe(200);
    expect(
      (await send('/session', { 'X-SocialPrune-Bootstrap': token })).status,
    ).toBe(401);
    const csrf = (JSON.parse(response.body) as { csrf: string }).csrf;
    const cookie = (response.headers['set-cookie'] as string[])[0]!.split(
      ';',
    )[0]!;
    expect(
      (
        await send(
          '/api/action',
          { 'X-SocialPrune-CSRF': csrf, Cookie: cookie },
          JSON.stringify({ action: 'start', version: 2 }),
        )
      ).status,
    ).toBe(409);
    const view = await send('/api/view', {
      'X-SocialPrune-CSRF': csrf,
      Cookie: cookie,
    });
    expect(JSON.parse(view.body)).toMatchObject({ phase: 'start', version: 1 });
  } finally {
    await server.close();
  }
});

test('profile guard proves takeover refusal and extension rejection on generated decoy folders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-profile-decoy-'));
  try {
    await writeFile(
      join(directory, 'existing.txt'),
      'Generated ordinary profile',
    );
    await expect(createProfile(directory)).rejects.toMatchObject({
      code: 'PROFILE_INVALID',
    });
    const profile = join(directory, 'dedicated');
    await createProfile(profile);
    await validateProfile(profile);
    expect((await profileSnapshot(profile)).extensions).toBe(0);
    await mkdir(
      join(profile, 'Default', 'Extensions', 'generated-extension', '1.0'),
      { recursive: true },
    );
    expect((await profileSnapshot(profile)).extensions).toBe(1);
    expect(await readFile(join(directory, 'existing.txt'), 'utf8')).toBe(
      'Generated ordinary profile',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('browser capability import graph excludes tests/fakes and all other commands; driver is lazy', async () => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const browserImports: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') await visit(path);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
        continue;
      const text = await readFile(path, 'utf8');
      const file = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
      );
      const specifiers: string[] = [];
      let staticDriver = false;
      function scan(node: ts.Node): void {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
            return;
          specifiers.push(node.moduleSpecifier.text);
          if (node.moduleSpecifier.text === 'playwright-core')
            staticDriver = true;
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        )
          specifiers.push(node.arguments[0].text);
        ts.forEachChild(node, scan);
      }
      scan(file);
      expect(staticDriver, path).toBe(false);
      for (const specifier of specifiers) {
        expect(specifier, path).not.toMatch(
          /(?:^|\/)(?:test|e2e|fake-x)(?:\/|$)/,
        );
        if (
          specifier.includes('/browser/') &&
          !path.includes(`${join('src', 'browser')}`)
        )
          browserImports.push(path.slice(source.length).replaceAll('\\', '/'));
      }
    }
  }
  await visit(source);
  expect([...new Set(browserImports)].sort()).toEqual([
    'commands/browser.ts',
    'commands/delete.ts',
    'commands/originals-fill.ts',
  ]);
});
