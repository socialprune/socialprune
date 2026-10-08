import { expect, test } from 'vitest';
import { createNodeContext } from '../cli/node-context.ts';
import { executeCli } from '../cli/adapter.ts';
import { capturedContext } from '../cli/test/context.ts';
import {
  injectionInput,
  assertFailureCases,
  assertNoFixtureStrings,
} from '../cli/test/injection-harness.ts';
import { inputs, request, running } from './test/helpers.ts';

test('review startup failures and protocol failures never echo or execute input fixture strings', async () => {
  const fixture = await inputs();
  const input = await injectionInput();
  const services = createNodeContext({ write() {} }, { write() {} }).services;
  const marker: unknown = Reflect.get(globalThis, input.marker);
  try {
    await assertFailureCases(
      [
        {
          name: 'review missing',
          args: ['review'],
          services,
          exitCode: 2,
          envelope: true,
        },
        {
          name: 'review old Node',
          args: ['review', '--workspace', input.text],
          services,
          nodeVersion: '24.14.1',
          exitCode: 1,
          envelope: true,
        },
        {
          name: 'review no channel',
          args: ['review', '--workspace', fixture.workspace, '--no-open'],
          services,
          exitCode: 2,
          envelope: true,
        },
        {
          name: 'review invalid workspace',
          args: ['review', '--workspace', input.text],
          services,
          context: { reviewAssetDirectory: fixture.assets },
          exitCode: 2,
          envelope: true,
        },
        {
          name: 'review invalid assets',
          args: ['review', '--workspace', fixture.workspace],
          services,
          context: { reviewAssetDirectory: input.text },
          exitCode: 1,
          envelope: true,
        },
        {
          name: 'review opener throws input',
          args: ['review', '--workspace', fixture.workspace],
          services,
          context: {
            reviewAssetDirectory: fixture.assets,
            openBrowser: () => {
              throw new Error(input.text);
            },
          },
          exitCode: 1,
          envelope: true,
        },
      ],
      input.forbidden,
    );
    const capture = capturedContext(services);
    expect(
      await executeCli(
        ['review', '--workspace', fixture.workspace, '--dry-run'],
        capture.context,
      ),
    ).toBe(0);
    assertNoFixtureStrings(
      capture.stdout.join(''),
      capture.stderr.join(''),
      input.forbidden,
    );
    const server = await running();
    try {
      await server.authenticate();
      const bad = await request(server.origin, {
        path: '/api/decide',
        headers: server.authHeaders(),
        body: input.text,
      });
      expect(bad.status).toBe(400);
      assertNoFixtureStrings(bad.text, '', input.forbidden);
      const failed = await server.api({
        type: 'detail',
        requestId: 'failure',
        itemId: input.forbidden[0]!,
      });
      expect(failed.replies).toEqual([
        { type: 'failed', requestId: 'failure', code: 'UNKNOWN_ITEM' },
      ]);
      assertNoFixtureStrings(failed.text, '', input.forbidden);
    } finally {
      await server.dispose();
    }
    expect(Reflect.get(globalThis, input.marker)).toBe(marker);
  } finally {
    await fixture.dispose();
  }
}, 60_000);
