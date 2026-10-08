import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  HttpReviewRequestSchema,
  WorkspaceReplySchema,
} from '@socialprune/core/workspace/protocol';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { request, running } from './test/helpers.ts';
import type { HttpResult } from './test/helpers.ts';
import { reviewAssetDirectory } from './static.ts';
import { resolve } from 'node:path';
import http from 'node:http';
import { rawBytes, rawRequest } from './test/raw-http.ts';

const policy =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune";
function headers(result: HttpResult) {
  expect(result.headers['content-security-policy']).toBe(policy);
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['referrer-policy']).toBe('no-referrer');
  expect(result.headers['cache-control']).toBe('no-store');
  expect(
    Object.keys(result.headers).filter((key) =>
      key.startsWith('access-control-'),
    ),
  ).toEqual([]);
}
test('missing Host reaches the router and returns 403 with the complete response policy', async () => {
  const fixture = await running();
  try {
    const result = await rawRequest(fixture.server.address.port);
    expect(result.status).toBe(403);
    headers(result);
  } finally {
    await fixture.dispose();
  }
});

test('unsupported Expect returns 417 with the response policy, while Node retains interim 100', async () => {
  const fixture = await running();
  try {
    const port = fixture.server.address.port;
    const host = `127.0.0.1:${port}`;
    const result = await rawRequest(port, {
      headers: [
        ['Host', host],
        ['Expect', 'foo'],
      ],
    });
    expect(result.status).toBe(417);
    headers(result);
    expect(result.text).toBe('');
    const interim = await rawBytes(
      port,
      `GET / HTTP/1.1\r\nHost: ${host}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n`,
    );
    expect(interim.raw.startsWith('HTTP/1.1 100 Continue\r\n\r\n')).toBe(true);
    expect(interim.raw.slice(interim.raw.indexOf('\r\n\r\n') + 4)).toContain(
      `Content-Security-Policy: ${policy}`,
    );
  } finally {
    await fixture.dispose();
  }
});

test('real incomplete header block closes between 10 and 12 seconds with the response policy', async () => {
  const fixture = await running();
  try {
    const port = fixture.server.address.port;
    const response = await rawBytes(
      port,
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`,
    );
    console.log(
      JSON.stringify({ headerTimeoutMs: Math.round(response.elapsedMs) }),
    );
    expect(response.elapsedMs).toBeGreaterThanOrEqual(10_000);
    expect(response.elapsedMs).toBeLessThanOrEqual(12_000);
    for (const line of [
      `Content-Security-Policy: ${policy}`,
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: no-referrer',
      'Cache-Control: no-store',
    ])
      expect(response.raw).toContain(line);
  } finally {
    await fixture.dispose();
  }
}, 90_000);

test('gate status regressions preserve state for duplicate authorities and credentials; exact size and concurrent exchange work', async () => {
  const fixture = await running();
  try {
    const exchanges = await Promise.all([
      fixture.exchange(),
      fixture.exchange(),
    ]);
    expect(exchanges.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    exchanges.forEach(headers);
    const winner = exchanges.find((response) => response.status === 200)!;
    const cookie = winner.headers['set-cookie']![0]!.split(';')[0]!;
    const csrf = (winner.data as { csrf: string }).csrf;
    const port = fixture.server.address.port,
      authority = `127.0.0.1:${port}`;
    const normal: [string, string][] = [
      ['Host', authority],
      ['Origin', fixture.origin],
      ['Content-Type', 'application/json'],
      ['Cookie', cookie],
      ['X-SocialPrune-CSRF', csrf],
    ];
    const decision = JSON.stringify({
      type: 'decide',
      requestId: 'rejected',
      commandId: 'rejected',
      itemIds: ['x:101'],
      expected: { 'x:101': 'undecided' },
      value: 'delete',
    });
    const cases: {
      name: string;
      headers: [string, string][];
      status: number;
    }[] = [
      {
        name: 'duplicate Host',
        headers: [...normal, ['Host', authority]],
        status: 403,
      },
      {
        name: 'Host trailing dot',
        headers: normal.map(([name, value]) => [
          name,
          name === 'Host' ? `127.0.0.1.:${port}` : value,
        ]),
        status: 403,
      },
      {
        name: 'Origin other port',
        headers: normal.map(([name, value]) => [
          name,
          name === 'Origin'
            ? `http://127.0.0.1:${port === 65535 ? 1 : port + 1}`
            : value,
        ]),
        status: 403,
      },
      {
        name: 'Origin https',
        headers: normal.map(([name, value]) => [
          name,
          name === 'Origin' ? `https://${authority}` : value,
        ]),
        status: 403,
      },
      {
        name: 'duplicate Origin',
        headers: [...normal, ['Origin', fixture.origin]],
        status: 403,
      },
      {
        name: 'wrong cookie name right value',
        headers: normal.map(([name, value]) => [
          name,
          name === 'Cookie'
            ? `sp_0000000000000000=${cookie.split('=')[1]!}`
            : value,
        ]),
        status: 401,
      },
      {
        name: 'wrong CSRF right length',
        headers: normal.map(([name, value]) => [
          name,
          name === 'X-SocialPrune-CSRF'
            ? (csrf[0] === 'A' ? 'B' : 'A').repeat(43)
            : value,
        ]),
        status: 403,
      },
      {
        name: 'JSON charset',
        headers: normal.map(([name, value]) => [
          name,
          name === 'Content-Type' ? 'application/json; charset=utf-8' : value,
        ]),
        status: 415,
      },
    ];
    for (const entry of cases) {
      const result = await rawRequest(port, {
        method: 'POST',
        path: '/api/decide',
        headers: entry.headers,
        body: decision,
      });
      expect(result.status, entry.name).toBe(entry.status);
      headers(result);
      const counter = await request(fixture.origin, {
        path: '/api/open',
        headers: Object.fromEntries(normal),
        body: JSON.stringify({
          type: 'open',
          requestId: 'counter',
          workspaceId: 'active',
        }),
      });
      expect(counter.data).toMatchObject([
        {
          summary: {
            revision: 0,
            counts: { decisionEvents: 0, outcomeEvents: 0 },
            decisions: { delete: 0 },
          },
        },
      ]);
    }
    const prefix = '{"type":"revision","requestId":"exact-size"';
    const exact = prefix + ' '.repeat(1024 * 1024 - prefix.length - 1) + '}';
    expect(Buffer.byteLength(exact)).toBe(1024 * 1024);
    const result = await request(fixture.origin, {
      path: '/api/revision',
      headers: Object.fromEntries(normal),
      body: exact,
    });
    expect(result.status).toBe(200);
    headers(result);
    expect(result.data).toEqual([
      { type: 'revision', requestId: 'exact-size', revision: 0 },
    ]);
  } finally {
    await fixture.dispose();
  }
});
test('foundation: real loopback, database thread, committed reply, shutdown and reopen', async () => {
  const fixture = await running();
  try {
    expect(reviewAssetDirectory()).toBe(
      resolve('apps/web/dist-review') +
        (process.platform === 'win32' ? '\\' : '/'),
    );
    expect(fixture.server.address).toMatchObject({
      address: '127.0.0.1',
      family: 'IPv4',
    });
    expect(fixture.server.timeouts).toEqual({
      headers: 10000,
      request: 30000,
      keepAlive: 5000,
    });
    await fixture.authenticate();
    const result = await fixture.api({
      type: 'decide',
      requestId: 'decision',
      commandId: 'human-one',
      itemIds: ['x:101'],
      expected: { 'x:101': 'undecided' },
      value: 'delete',
    });
    expect(result.status).toBe(200);
    expect(result.replies).toMatchObject([
      { type: 'committed', requestId: 'decision', changed: 1 },
    ]);
    const reply = await fixture.api({ type: 'shutdown', requestId: 'stop' });
    expect(reply.replies).toEqual([{ type: 'done', requestId: 'stop' }]);
    await fixture.server.closed;
    const store = await SQLiteStore.open(
      join(fixture.workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    try {
      expect(await store.read((tx) => tx.state.get('x:101'))).toMatchObject({
        decision: 'delete',
      });
      const events = await store.read(async (tx) => {
        const result = [];
        for await (const event of tx.decisionEvents.iterate())
          result.push(event);
        return result;
      });
      expect(events).toMatchObject([
        { source: { kind: 'human', via: 'local-review' }, value: 'delete' },
      ]);
    } finally {
      await store.close();
    }
    await expect(request(fixture.origin)).rejects.toThrow();
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('16 evidence probes reject all hostile requests without changing state or CORS', async () => {
  let now = Date.now();
  const fixture = await running(2, () => now);
  try {
    const decision = JSON.stringify({
      type: 'decide',
      requestId: 'probe',
      commandId: 'probe',
      itemIds: ['x:101'],
      expected: { 'x:101': 'undecided' },
      value: 'delete',
    });
    const probes: [string, string, Record<string, string>, number][] = [
      [
        'forged Host',
        '/api/decide',
        { ...fixture.base, Host: 'foreign.invalid' },
        403,
      ],
      [
        'Host prefix',
        '/api/decide',
        {
          ...fixture.base,
          Host: `${new URL(fixture.origin).host}.foreign.invalid`,
        },
        403,
      ],
      [
        'foreign Origin',
        '/session',
        { ...fixture.base, Origin: 'https://foreign.invalid' },
        403,
      ],
      ['null Origin', '/session', { ...fixture.base, Origin: 'null' }, 403],
      ['no authentication', '/api/decide', fixture.base, 401],
      ['missing bootstrap', '/session', fixture.base, 401],
      [
        'wrong bootstrap',
        '/session',
        { ...fixture.base, 'X-SocialPrune-Bootstrap': 'a'.repeat(43) },
        401,
      ],
    ];
    for (const [name, path, values, status] of probes) {
      const response = await request(fixture.origin, {
        path,
        headers: values,
        body: path === '/session' ? '{}' : decision,
      });
      expect(response.status, name).toBe(status);
      headers(response);
    }
    const preflight = await request(fixture.origin, {
      path: '/api/decide',
      method: 'OPTIONS',
      headers: { ...fixture.base, Origin: 'https://foreign.invalid' },
    });
    expect(preflight.status).toBe(403);
    headers(preflight);
    const exchange = await fixture.authenticate();
    expect(exchange.status).toBe(200);
    headers(exchange);
    expect(exchange.headers['set-cookie']).toHaveLength(1);
    expect(exchange.headers['set-cookie']![0]).toMatch(
      /^sp_[a-f0-9]{16}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    expect((exchange.data as { csrf: string }).csrf).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    const replay = await fixture.exchange();
    expect(replay.status).toBe(401);
    headers(replay);
    for (const [name, values, status] of [
      [
        'authenticated foreign Origin',
        { ...fixture.authHeaders(), Origin: 'https://foreign.invalid' },
        403,
      ],
      ['missing Origin', { ...fixture.authHeaders(), Origin: '' }, 403],
      [
        'missing CSRF',
        { ...fixture.authHeaders(), 'X-SocialPrune-CSRF': '' },
        403,
      ],
      [
        'form content',
        {
          ...fixture.authHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        415,
      ],
    ] as const) {
      const result = await request(fixture.origin, {
        path: '/api/decide',
        headers: values,
        body: decision,
      });
      expect(result.status, name).toBe(status);
      headers(result);
    }
    const before = await fixture.api({
      type: 'open',
      requestId: 'before',
      workspaceId: 'not-a-filesystem-path',
    });
    expect(before.replies).toMatchObject([
      {
        summary: {
          counts: { decisionEvents: 0 },
          decisions: { delete: 0, undecided: 2 },
        },
      },
    ]);
    const authorized = await request(fixture.origin, {
      path: '/api/decide',
      headers: fixture.authHeaders(),
      body: decision,
    });
    expect(authorized.status).toBe(200);
    headers(authorized);
    const state = await fixture.api({
      type: 'open',
      requestId: 'counter',
      workspaceId: 'active',
    });
    expect(state.replies).toMatchObject([
      { summary: { counts: { decisionEvents: 1 }, decisions: { delete: 1 } } },
    ]);
    now += 10 * 60000;
    const fresh = await running(2, () => now);
    try {
      now += 10 * 60000;
      const expired = await fresh.exchange();
      expect(expired.status).toBe(401);
      headers(expired);
    } finally {
      await fresh.dispose();
    }
    // LL-002: the absence oracle is proven against input-planted headers.
    expect(() =>
      headers({
        ...authorized,
        headers: { ...authorized.headers, 'access-control-allow-origin': '*' },
      }),
    ).toThrow();
  } finally {
    await fixture.dispose();
  }
  // Measured 2,251 ms in the full parallel CLI and core run on 2026-10-08.
}, 60_000);

test('wire status table and precedence: Host, method, Origin, content, size, session, CSRF, body', async () => {
  const fixture = await running();
  try {
    await fixture.authenticate();
    const normal = fixture.authHeaders();
    const {
      Origin: omittedOrigin,
      'X-SocialPrune-CSRF': omittedCsrf,
      ...missingBoth
    } = normal;
    void omittedOrigin;
    void omittedCsrf;
    const cases = [
      { method: 'GET', headers: { Host: 'wrong' }, body: '{', status: 403 },
      { method: 'GET', headers: { Host: normal.Host }, body: '{', status: 405 },
      { method: 'OPTIONS', headers: normal, status: 403 },
      { headers: { ...normal, Origin: '' }, body: '{', status: 403 },
      { headers: missingBoth, status: 403 },
      { headers: { ...missingBoth, Origin: normal.Origin }, status: 403 },
      {
        headers: { ...normal, 'Content-Type': 'text/plain', Cookie: '' },
        body: '{',
        status: 415,
      },
      {
        headers: {
          ...normal,
          Cookie: '',
          'Content-Length': String(1024 * 1024 + 1),
        },
        body: 'a'.repeat(1024 * 1024 + 1),
        status: 413,
      },
      {
        headers: { ...normal, Cookie: '', 'X-SocialPrune-CSRF': '' },
        body: '{',
        status: 401,
      },
      {
        headers: { ...normal, 'X-SocialPrune-CSRF': 'wrong' },
        body: '{',
        status: 403,
      },
      { headers: normal, body: '{', status: 400 },
      { headers: normal, body: '{}', status: 400 },
      {
        headers: normal,
        body: JSON.stringify({
          type: 'open',
          requestId: 'wrong-path',
          workspaceId: 'active',
        }),
        status: 400,
      },
      {
        headers: { ...normal, Cookie: 'sp_deadbeefdeadbeef=unknown' },
        status: 401,
      },
    ];
    for (const item of cases) {
      const response = await request(fixture.origin, {
        path: '/api/revision',
        ...item,
      });
      expect(response.status).toBe(item.status);
      headers(response);
    }
    for (const Host of [
      'localhost:' + new URL(fixture.origin).port,
      '[::1]:' + new URL(fixture.origin).port,
      '127.0.0.1',
      normal.Host + '.foreign.invalid',
    ]) {
      const result = await request(fixture.origin, {
        path: '/',
        method: 'GET',
        headers: { Host },
      });
      expect(result.status).toBe(403);
      headers(result);
    }
    for (const path of [
      '/api/backup',
      '/api/restore',
      '/api/attachImport',
      '/api/deleteWorkspace',
      '/api/approve',
      '/api/unknown',
    ]) {
      const result = await request(fixture.origin, { path, headers: normal });
      expect(result.status).toBe(404);
      headers(result);
    }
    const over = await request(fixture.origin, {
      path: '/api/revision',
      headers: normal,
      body: 'a'.repeat(1024 * 1024 + 1),
    });
    expect(over.status).toBe(413);
    headers(over);
    expect(
      (await fixture.api({ type: 'revision', requestId: 'poll' })).replies,
    ).toEqual([{ type: 'revision', requestId: 'poll', revision: 0 }]);
    expect(
      (
        await fixture.api({
          type: 'open',
          requestId: 'unchanged',
          workspaceId: 'active',
        })
      ).replies,
    ).toMatchObject([
      { summary: { counts: { decisionEvents: 0, outcomeEvents: 0 } } },
    ]);
  } finally {
    await fixture.dispose();
  }
});

test('HTTP preview confirmation is page-bound and records only its frozen selection', async () => {
  const fixture = await running();
  try {
    await fixture.authenticate();
    await fixture.api({
      type: 'query',
      requestId: 'query',
      queryId: 'view',
      generation: 1,
      accountKey: 'x:generated',
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    });
    const preview = await fixture.api({
      type: 'previewBulk',
      requestId: 'preview',
      queryId: 'view',
      generation: 1,
      pageId: 'human-page',
      previewId: 'preview',
      value: 'delete',
      overwrite: ['undecided'],
      itemIds: ['x:101', 'foreign'],
    });
    expect(preview.replies).toMatchObject([
      {
        type: 'bulkPreview',
        total: 1,
        selection: { requested: 2, inView: 1, notInView: 1 },
      },
    ]);
    expect(
      (
        await fixture.api({
          type: 'confirmBulk',
          requestId: 'wrong-page',
          commandId: 'wrong-page',
          pageId: 'foreign-page',
          previewId: 'preview',
        })
      ).replies,
    ).toMatchObject([{ type: 'rejected', code: 'PREVIEW_EXPIRED' }]);
    const confirmed = await fixture.api({
      type: 'confirmBulk',
      requestId: 'confirm',
      commandId: 'confirm',
      pageId: 'human-page',
      previewId: 'preview',
    });
    expect(confirmed.replies).toMatchObject([
      { type: 'committed', changed: 1 },
    ]);
    expect(
      (
        await fixture.api({
          type: 'detail',
          requestId: 'saved',
          itemId: 'x:101',
        })
      ).replies,
    ).toMatchObject([
      { events: [{ source: { kind: 'human', via: 'local-review' } }] },
    ]);
    expect(
      (
        await fixture.api({
          type: 'detail',
          requestId: 'not-selected',
          itemId: 'x:102',
        })
      ).replies,
    ).toMatchObject([{ events: [] }]);
    await fixture.api({
      type: 'previewBulk',
      requestId: 'next',
      queryId: 'view',
      generation: 1,
      pageId: 'human-page',
      previewId: 'next',
      value: 'later',
      overwrite: ['undecided'],
    });
    expect(
      (
        await fixture.api({
          type: 'releasePreview',
          requestId: 'release',
          pageId: 'human-page',
          previewId: 'next',
        })
      ).replies,
    ).toEqual([{ type: 'released', requestId: 'release' }]);
    expect(
      (
        await fixture.api({
          type: 'confirmBulk',
          requestId: 'expired',
          commandId: 'expired',
          pageId: 'human-page',
          previewId: 'next',
        })
      ).replies,
    ).toMatchObject([{ type: 'rejected', code: 'PREVIEW_EXPIRED' }]);
  } finally {
    await fixture.dispose();
  }
});

test('static startup map rejects traversal/encoded separators and applies policy to every response', async () => {
  const fixture = await running();
  try {
    await writeFile(
      join(fixture.assets, 'added-later.js'),
      'not in startup map',
    );
    for (const path of [
      '/',
      '/index.html',
      '/assets/app.js',
      '/assets/app.css',
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const result = await request(fixture.origin, { path, method });
        expect(result.status).toBe(200);
        headers(result);
        if (method === 'HEAD') expect(result.text).toBe('');
      }
    }
    for (const path of [
      '/../index.html',
      '/assets/../index.html',
      '/%2e%2e/index.html',
      '/assets%2fapp.js',
      '/assets%2Fapp.js',
      '/assets%5capp.js',
      '/assets\\app.js',
      '/added-later.js',
      '/%00',
      '/index.html/',
    ]) {
      const result = await request(fixture.origin, { path, method: 'GET' });
      expect(result.status, path).toBe(404);
      headers(result);
    }
    const post = await request(fixture.origin, { path: '/', method: 'POST' });
    expect(post.status).toBe(405);
    headers(post);
    const root = await readFile(join(fixture.assets, 'index.html'), 'utf8');
    expect((await request(fixture.origin, { method: 'GET' })).text).toBe(root);
  } finally {
    await fixture.dispose();
  }
});

test('stop closes an actual idle keep-alive socket and the worker before resolving', async () => {
  const fixture = await running();
  const agent = new http.Agent({ keepAlive: true });
  try {
    const socket = await new Promise<import('node:net').Socket>(
      (resolve, reject) => {
        const request = http.get(fixture.server.url, { agent }, (response) => {
          const socket = response.socket;
          response.resume();
          response.once('end', () => resolve(socket));
        });
        request.once('error', reject);
      },
    );
    const closed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );
    await fixture.server.stop();
    await closed;
    expect(socket.destroyed).toBe(true);
    await expect(request(fixture.origin)).rejects.toThrow();
  } finally {
    agent.destroy();
    await fixture.dispose();
  }
});

test('API uses only the shared schema; decisions cannot choose source and acknowledged events persist', async () => {
  const fixture = await running();
  try {
    await fixture.authenticate();
    const query = {
      type: 'query',
      requestId: 'query',
      queryId: 'view',
      generation: 1,
      accountKey: 'x:generated',
      filter: {},
      sort: [{ by: 'id', direction: 'asc' }],
      search: '',
    } as const;
    expect(
      (await fixture.api({ ...query, sort: [...query.sort] })).replies,
    ).toMatchObject([{ type: 'queryResult', total: 2 }]);
    expect(
      (
        await fixture.api({
          type: 'window',
          requestId: 'rows',
          queryId: 'view',
          generation: 1,
          offset: 0,
          limit: 200,
        })
      ).replies,
    ).toMatchObject([
      {
        type: 'rows',
        rows: fixture.initial.items.map((item) => ({
          id: item.id,
          text: item.text,
          decision: 'undecided',
        })),
      },
    ]);
    const raw = {
      type: 'decide',
      requestId: 'forged',
      commandId: 'forged',
      itemIds: ['x:101'],
      expected: { 'x:101': 'undecided' },
      value: 'delete',
      source: { kind: 'human', via: 'web-review' },
    };
    const forged = await request(fixture.origin, {
      path: '/api/decide',
      headers: fixture.authHeaders(),
      body: JSON.stringify(raw),
    });
    expect(forged.status).toBe(400);
    const decide = {
      type: 'decide',
      requestId: 'write',
      commandId: 'write',
      itemIds: ['x:101'],
      expected: { 'x:101': 'undecided' },
      value: 'delete',
    } as const;
    for (const requestId of ['write', 'repeat'])
      expect(
        (
          await fixture.api({
            ...decide,
            requestId,
            itemIds: [...decide.itemIds],
          })
        ).replies,
      ).toMatchObject([{ type: 'committed', changed: 1, revision: 1 }]);
    expect(
      (
        await fixture.api({
          type: 'outcome',
          requestId: 'outcome',
          commandId: 'outcome',
          itemIds: ['x:101'],
          expected: { 'x:101': 'unknown' },
          value: 'deleted-by-user',
        })
      ).replies,
    ).toMatchObject([{ type: 'committed', revision: 2 }]);
    const detail = await fixture.api({
      type: 'detail',
      requestId: 'detail',
      itemId: 'x:101',
    });
    expect(detail.replies).toMatchObject([
      {
        type: 'itemDetail',
        events: [
          { source: { via: 'local-review' } },
          { source: { via: 'local-review' } },
        ],
      },
    ]);
    expect(
      (
        await fixture.api({
          type: 'undo',
          requestId: 'undo',
          commandId: 'undo',
        })
      ).replies,
    ).toMatchObject([{ type: 'committed', revision: 3 }]);
    expect(
      (
        await fixture.api({
          type: 'redo',
          requestId: 'redo',
          commandId: 'redo',
        })
      ).replies,
    ).toMatchObject([{ type: 'committed', revision: 4 }]);
    expect(
      (await fixture.api({ type: 'history', requestId: 'history', limit: 200 }))
        .replies,
    ).toMatchObject([
      {
        type: 'historyEntries',
        entries: [
          { kind: 'redo' },
          { kind: 'undo' },
          { kind: 'single' },
          { kind: 'single' },
        ],
      },
    ]);
    expect(
      (
        await fixture.api({
          type: 'setTimeZone',
          requestId: 'zone',
          timeZone: 'UTC',
        })
      ).replies,
    ).toMatchObject([
      { type: 'settingsChanged', revision: 5, timeZone: 'UTC' },
    ]);
    expect(
      (
        await fixture.api({
          type: 'clickListOpen',
          requestId: 'list',
          listId: 'list',
          accountKey: 'x:generated',
        })
      ).replies,
    ).toMatchObject([{ type: 'clickListOpened', total: 1 }]);
    expect(
      (
        await fixture.api({
          type: 'clickListWindow',
          requestId: 'entries',
          listId: 'list',
          offset: 0,
          limit: 200,
        })
      ).replies,
    ).toMatchObject([{ type: 'clickListEntries' }]);
    const exported = (
      await fixture.api({
        type: 'clickListExport',
        requestId: 'export',
        listId: 'list',
        format: 'csv',
      })
    ).replies;
    expect(exported.at(-1)).toMatchObject({
      type: 'clickListExported',
      entries: 1,
    });
    expect(
      exported
        .slice(0, -1)
        .every(
          (reply) =>
            reply.type === 'clickListExportChunk' || reply.type === 'progress',
        ),
    ).toBe(true);
    for (const reply of exported)
      expect(WorkspaceReplySchema.safeParse(reply).success).toBe(true);
    expect(HttpReviewRequestSchema.safeParse(raw).success).toBe(false);
  } finally {
    await fixture.dispose();
  }
});
