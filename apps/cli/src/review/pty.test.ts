import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { inputs, request } from './test/helpers.ts';

it.runIf(process.platform === 'linux')(
  'real util-linux PTY delivers --no-open bootstrap once only on terminal stderr',
  async () => {
    expect(
      spawnSync('script', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).status,
    ).toBe(0);
    const fixture = await inputs();
    const output = join(fixture.directory, 'stdout.json');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const args = [
      process.execPath,
      fileURLToPath(new URL('./test/command-child.ts', import.meta.url)),
      fixture.assets,
      'ok',
      'native',
      'review',
      '--workspace',
      fixture.workspace,
      '--no-open',
      '--json',
    ];
    const child = spawn(
      'script',
      [
        '--quiet',
        '--return',
        '--command',
        args.map(quote).join(' ') + ' >' + quote(output),
        '/dev/null',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let terminal = '',
      outerError = '';
    const ended = new Promise<number | null>((resolve) =>
      child.once('close', (code) => resolve(code)),
    );
    const tokenUrl = new Promise<string>((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', (part: Buffer) => {
        terminal += part.toString();
        const url = terminal.match(
          /http:\/\/127\.0\.0\.1:\d+\/#bootstrap=[A-Za-z0-9_-]{43}/,
        )?.[0];
        if (url) resolve(url);
      });
      child.once('close', () =>
        reject(new Error('PTY ended before token delivery.')),
      );
    });
    child.stderr.on('data', (part: Buffer) => {
      outerError += part.toString();
    });
    try {
      const url = await tokenUrl;
      const parsed = new URL(url),
        token = parsed.hash.slice('#bootstrap='.length);
      const base = {
        Host: parsed.host,
        Origin: parsed.origin,
        'Content-Type': 'application/json',
      };
      const session = await request(parsed.origin, {
        path: '/session',
        headers: { ...base, 'X-SocialPrune-Bootstrap': token },
      });
      expect(session.status).toBe(200);
      const shutdown = await request(parsed.origin, {
        path: '/api/shutdown',
        headers: {
          ...base,
          Cookie: session.headers['set-cookie']![0]!.split(';')[0]!,
          'X-SocialPrune-CSRF': (session.data as { csrf: string }).csrf,
        },
        body: JSON.stringify({ type: 'shutdown', requestId: 'pty-stop' }),
      });
      expect(shutdown.status).toBe(200);
      expect(await ended).toBe(0);
      expect(terminal.replaceAll('\r', '')).toBe(url + '\n');
      expect(terminal.split(token)).toHaveLength(2);
      expect(outerError).not.toContain(token);
      const stdout = await readFile(output, 'utf8');
      expect(stdout).not.toContain(token);
      expect(JSON.parse(stdout)).toMatchObject({
        data: { tokenDelivery: 'terminal' },
      });
      for (const name of await readdir(fixture.workspace))
        expect(
          (await readFile(join(fixture.workspace, name))).includes(
            Buffer.from(token),
          ),
        ).toBe(false);
      expect(() => expect(stdout + token).not.toContain(token)).toThrow();
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await ended;
      }
      await fixture.dispose();
    }
  },
  // D40: the full Linux CLI run measured 2,065 ms on Node 24.15.0.
  60_000,
);
