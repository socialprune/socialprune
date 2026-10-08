import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { Writable } from 'node:stream';
import { expect, test, it } from 'vitest';
import { openReviewBrowser, OPENER_SCRIPT } from './opener.ts';

test('fixed shell-free openers use stdin on Windows and the URL argument on macOS/Linux', async () => {
  const url = 'http://127.0.0.1:12345/#bootstrap=' + 'b'.repeat(43);
  for (const [platform, command, args] of [
    [
      'win32',
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$u = [Console]::In.ReadLine(); Start-Process -FilePath $u',
      ],
    ],
    ['darwin', 'open', [url]],
    ['linux', 'xdg-open', [url]],
  ] as const) {
    const calls: { command: string; args: string[]; options: SpawnOptions }[] =
      [];
    const input: string[] = [];
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        input.push(chunk.toString());
        callback();
      },
    });
    await openReviewBrowser(url, platform, (name, values, options) => {
      calls.push({ command: name, args: values, options });
      const child = Object.assign(new EventEmitter(), { stdin });
      queueMicrotask(() => child.emit('close', 0));
      return child as ChildProcess;
    });
    expect(calls).toEqual([
      {
        command,
        args,
        options: {
          shell: false,
          stdio: platform === 'win32' ? ['pipe', 'ignore', 'ignore'] : 'ignore',
          windowsHide: true,
        },
      },
    ]);
    if (platform === 'win32') {
      expect(valuesContainToken(calls[0]!.args, url)).toBe(false);
      expect(input).toEqual([`${url}\n`]);
      expect(stdin.writableEnded).toBe(true);
    } else {
      expect(input).toEqual([]);
      expect(stdin.writableEnded).toBe(false);
    }
    await expect(
      openReviewBrowser(url, platform, () => {
        throw new Error(url);
      }),
    ).rejects.toThrow('Could not open the browser');
    for (const failure of [
      'exit',
      'spawn',
      ...(platform === 'win32' ? ['stdin'] : []),
    ]) {
      const result = openReviewBrowser(url, platform, () => {
        const stdin = new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        });
        const child = Object.assign(new EventEmitter(), { stdin });
        queueMicrotask(() => {
          if (failure === 'exit') child.emit('close', 1);
          else if (failure === 'spawn') child.emit('error', new Error(url));
          else
            stdin.emit(
              'error',
              Object.assign(new Error(url), { code: 'EPIPE' }),
            );
        });
        return child as ChildProcess;
      });
      await expect(result).rejects.toMatchObject({
        code: 'BROWSER_OPEN_FAILED',
      });
      await expect(result).rejects.not.toThrow(url);
    }
  }
  await expect(openReviewBrowser('https://foreign.invalid/')).rejects.toThrow();
});

function valuesContainToken(args: string[], url: string): boolean {
  const token = new URL(url).hash.slice('#bootstrap='.length);
  return args.some((value) => value.includes(token));
}

it.runIf(process.platform === 'win32')(
  'real PowerShell receives the stdin URL byte for byte; old argv script fails the same oracle',
  () => {
    const url = 'http://127.0.0.1:54321/#bootstrap=' + 'c'.repeat(43);
    const shadow =
      'function Start-Process { param([Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$FilePath) [Console]::Out.Write($FilePath) }; ';
    function canary(script: string, args: string[] = []) {
      return spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', shadow + script, ...args],
        {
          input: `${url}\n`,
          shell: false,
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    }
    const assertReceived = (result: ReturnType<typeof canary>) => {
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(url);
      expect(result.stderr).toBe('');
    };
    assertReceived(canary(OPENER_SCRIPT));
    const defect = canary('Start-Process -FilePath $args[0]', [url]);
    expect(defect.status).toBe(1);
    expect(defect.stderr).toContain('ParameterArgumentValidationError');
    expect(() => assertReceived(defect)).toThrow();
  },
);
