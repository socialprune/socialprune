import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { inputs, request } from './test/helpers.ts';

function child(
  assets: string,
  workspace: string,
  flags: string[],
  opener = 'ok',
  tty = 'pipe',
) {
  const process = spawn(
    globalThis.process.execPath,
    [
      '--import',
      new URL('./test/http-thread-loader.ts', import.meta.url).href,
      fileURLToPath(new URL('./test/command-child.ts', import.meta.url)),
      assets,
      opener,
      tty,
      'review',
      '--workspace',
      workspace,
      ...flags,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let stdout = '',
    stderr = '';
  const urls: string[] = [];
  let ready!: (url: string) => void;
  const opened = new Promise<string>((resolve) => {
    ready = resolve;
  });
  process.stdout!.on('data', (part: Buffer) => {
    stdout += part.toString();
  });
  process.stderr!.on('data', (part: Buffer) => {
    stderr += part.toString();
    const url = stderr.match(
      /http:\/\/127\.0\.0\.1:\d+\/#bootstrap=[A-Za-z0-9_-]{43}/,
    )?.[0];
    if (url) ready(url);
  });
  process.on('message', (message: { type: string; url: string }) => {
    if (message.type === 'opened') {
      urls.push(message.url);
      ready(message.url);
    }
  });
  // Read streams only after close, which follows exit and drains both pipes.
  const ended = once(process, 'close');
  return { process, opened, ended, urls, streams: () => ({ stdout, stderr }) };
}
async function shutdown(url: string) {
  const parsed = new URL(url),
    origin = parsed.origin;
  const base = {
    Host: parsed.host,
    Origin: origin,
    'Content-Type': 'application/json',
  };
  const session = await request(origin, {
    path: '/session',
    headers: {
      ...base,
      'X-SocialPrune-Bootstrap': parsed.hash.slice('#bootstrap='.length),
    },
  });
  const csrf = (session.data as { csrf: string }).csrf;
  const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
  return request(origin, {
    path: '/api/shutdown',
    headers: { ...base, Cookie: cookie, 'X-SocialPrune-CSRF': csrf },
    body: JSON.stringify({ type: 'shutdown', requestId: 'stop' }),
  });
}
function noToken(streams: { stdout: string; stderr: string }, token: string) {
  expect(streams.stdout).not.toContain(token);
  expect(streams.stderr).not.toContain(token);
}

test('real piped command table, token only to opener, one JSON readiness and committed stop', async () => {
  const data = await inputs();
  try {
    for (const json of [false, true]) {
      const run = child(data.assets, data.workspace, json ? ['--json'] : []);
      try {
        const url = await run.opened;
        expect(new URL(url).hash).toMatch(/^#bootstrap=[A-Za-z0-9_-]{43}$/);
        expect(await shutdown(url)).toMatchObject({ status: 200 });
        expect((await run.ended)[0]).toBe(0);
        const output = run.streams(),
          token = new URL(url).hash.slice('#bootstrap='.length);
        noToken(output, token);
        expect(() =>
          noToken({ ...output, stdout: output.stdout + token }, token),
        ).toThrow();
        expect(output.stderr).toBe(
          `Review is running at ${new URL(url).origin}/. Your browser opens it now. Press Ctrl+C to stop.\n`,
        );
        if (json)
          expect(JSON.parse(output.stdout)).toEqual({
            schemaVersion: 1,
            command: 'review',
            status: 'ok',
            data: {
              lifecycle: 'running',
              url: `${new URL(url).origin}/`,
              tokenDelivery: 'browser',
              pid: run.process.pid,
            },
            warnings: [],
          });
        else expect(output.stdout).toBe('');
        expect(run.urls).toEqual([url]);
        for (const name of await readdir(data.workspace))
          expect(await readFile(join(data.workspace, name))).not.toContain(
            Buffer.from(token),
          );
      } finally {
        if (run.process.exitCode === null) {
          run.process.kill();
          await run.ended;
        }
      }
    }
    const fail = child(data.assets, data.workspace, [], 'fail');
    const url = await fail.opened;
    expect((await fail.ended)[0]).toBe(1);
    noToken(fail.streams(), new URL(url).hash.slice('#bootstrap='.length));
    expect(JSON.parse(fail.streams().stdout)).toMatchObject({
      status: 'error',
      error: { code: 'BROWSER_OPEN_FAILED', exitCode: 1 },
    });
    await expect(request(new URL(url).origin)).rejects.toThrow();
    const noChannel = child(data.assets, data.workspace, ['--no-open']);
    expect((await noChannel.ended)[0]).toBe(2);
    expect(noChannel.urls).toEqual([]);
    expect(noChannel.streams().stderr).not.toContain('#bootstrap');
    expect(JSON.parse(noChannel.streams().stdout)).toMatchObject({
      error: { code: 'NO_TOKEN_CHANNEL' },
    });
  } finally {
    await data.dispose();
  }
}, 60_000);

test('injected terminal branches print token once, readiness never contains it, opener failure falls back', async () => {
  const data = await inputs();
  try {
    for (const json of [false, true]) {
      for (const noOpen of [true, false]) {
        const run = child(
          data.assets,
          data.workspace,
          [...(json ? ['--json'] : []), ...(noOpen ? ['--no-open'] : [])],
          noOpen ? 'ok' : 'fail',
          'terminal',
        );
        try {
          const url = await run.opened;
          await shutdown(url);
          expect((await run.ended)[0]).toBe(0);
          const output = run.streams();
          expect(output.stderr).toBe(url + '\n');
          expect(output.stdout).not.toContain(
            new URL(url).hash.slice('#bootstrap='.length),
          );
          if (json)
            expect(JSON.parse(output.stdout)).toMatchObject({
              data: { tokenDelivery: 'terminal' },
            });
          else expect(output.stdout).toBe('');
          expect(run.urls).toHaveLength(noOpen ? 0 : 1);
        } finally {
          if (run.process.exitCode === null) {
            run.process.kill();
            await run.ended;
          }
        }
      }
    }
  } finally {
    await data.dispose();
  }
}, 60_000);

test('dry-run returns counts, opens nothing, does not change workspace; Node guard precedes files', async () => {
  const data = await inputs();
  try {
    const file = join(data.workspace, 'socialprune.sqlite');
    const before = await readFile(file);
    const capture = capturedContext(
      createNodeContext({ write() {} }, { write() {} }).services,
    );
    expect(
      await executeCli(
        ['review', '--workspace', data.workspace, '--dry-run', '--json'],
        capture.context,
      ),
    ).toBe(0);
    expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
      data: { dryRun: true, counts: data.initial.counts },
    });
    expect(capture.stderr).toEqual([]);
    expect(capture.opened).toEqual([]);
    expect(await readFile(file)).toEqual(before);
    const unsupported = capturedContext(capture.context.services);
    expect(
      await executeCli(['review', '--workspace', 'does-not-exist', '--json'], {
        ...unsupported.context,
        nodeVersion: '24.14.1',
      }),
    ).toBe(1);
    expect(JSON.parse(unsupported.stdout.join(''))).toMatchObject({
      error: { code: 'NODE_TOO_OLD' },
    });
    expect(unsupported.opened).toEqual([]);
  } finally {
    await data.dispose();
  }
});

test('SIGINT and SIGTERM close the listener and database; SQLite never loads on HTTP thread', async () => {
  const data = await inputs();
  try {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const run = child(data.assets, data.workspace, ['--json']);
      try {
        const url = await run.opened;
        if (process.platform === 'win32') run.process.send(signal);
        else run.process.kill(signal);
        expect((await run.ended)[0]).toBe(0);
        expect(run.streams().stderr).not.toContain('SQLITE_ON_HTTP_THREAD');
        await expect(request(new URL(url).origin)).rejects.toThrow();
      } finally {
        if (run.process.exitCode === null) {
          run.process.kill();
          await run.ended;
        }
      }
    }
    const negative = spawnSync(
      process.execPath,
      [
        '--import',
        new URL('./test/http-thread-loader.ts', import.meta.url).href,
        '--input-type=module',
        '-e',
        "await import('node:sqlite')",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(negative.status).toBe(1);
    expect(negative.stderr).toContain('SQLITE_ON_HTTP_THREAD');
  } finally {
    await data.dispose();
  }
}, 60_000);
