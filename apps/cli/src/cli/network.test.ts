import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { executeCli } from './adapter.ts';
import { createNodeContext } from './node-context.ts';
import { capturedContext } from './test/context.ts';
import { networkRecorder } from './test/network-recorder.ts';

const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);

function assertNoCalls(calls: readonly string[]): void {
  expect(calls).toEqual([]);
}

test('network observer catches every required outbound surface independently', () => {
  const recorder = networkRecorder();
  try {
    const required = [
      'fetch',
      'WebSocket',
      'http.request',
      'http.get',
      'https.request',
      'https.get',
      'http2.connect',
      'net.connect',
      'net.createConnection',
      'tls.connect',
      'dgram.createSocket',
    ];
    for (const [name, target] of [
      ['dns', dns],
      ['dns/promises', dnsPromises],
    ] as const) {
      for (const key of Object.keys(target)) {
        if (
          key === 'lookup' ||
          key === 'lookupService' ||
          key.startsWith('resolve')
        )
          required.push(`${name}.${key}`);
      }
    }
    expect(recorder.probes.map((probe) => probe.name).sort()).toEqual(
      required.sort(),
    );
    for (const probe of recorder.probes) {
      recorder.calls.length = 0;
      expect(() => probe.invoke(), probe.name).toThrow(
        'Network recorder stopped a call.',
      );
      expect(recorder.calls, probe.name).toEqual([probe.name]);
      // The zero-network assertion itself must reject the planted call.
      expect(() => assertNoCalls(recorder.calls), probe.name).toThrow();
    }
  } finally {
    recorder.restore();
  }
});

test('all C1 routes, help, review dry-run and bad arguments make no network or opener call', async () => {
  const recorder = networkRecorder();
  try {
    const cases: readonly [readonly string[], number][] = [
      [[], 2],
      [['--help'], 0],
      [['--help', '--json'], 0],
      [['structure', '--help'], 0],
      [['structure', archive], 0],
      [['structure', archive, '--json'], 0],
      [['structure'], 2],
      [['structure', archive, '--bad'], 2],
      [['guide', 'x'], 0],
      [['guide', 'instagram', '--lang', 'de', '--json'], 0],
      [['guide', 'x', '--bad'], 2],
      [['schemas'], 0],
      [['schemas', '--json'], 0],
      [['schemas', '--bad'], 2],
      [['scan'], 2],
      [['scan', '--json'], 2],
      [['mcp', '--json'], 2],
      [['review', '--dry-run'], 2],
      [['review', '--workspace', archive, '--dry-run'], 2],
      [['review', '--workspace', archive, '--dry-run', '--json'], 2],
      [['bad-route', '--json'], 2],
      [['--bad'], 2],
    ];
    for (const [args, exitCode] of cases) {
      const capture = capturedContext({
        guides: [],
        describeStructure() {
          return Promise.reject(new Error('Use the real service.'));
        },
        listSchemas() {
          return Promise.resolve([]);
        },
      });
      const context = createNodeContext(
        capture.context.io.stdout,
        capture.context.io.stderr,
      );
      expect(
        await executeCli(args, {
          ...context,
          openBrowser: capture.context.openBrowser,
        }),
        args.join(' '),
      ).toBe(exitCode);
      assertNoCalls(recorder.calls);
      expect(capture.opened, args.join(' ')).toEqual([]);
    }
  } finally {
    recorder.restore();
  }
}, 60_000);
