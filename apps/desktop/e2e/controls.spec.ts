import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { expect, test } from '@playwright/test';
import { executable } from '../packaging/paths.ts';
import { assertFuses } from '../packaging/fuses.ts';
import {
  assertPolicyEvents,
  assertRenderer,
  observePolicy,
  rendererState,
} from '../test/controls.ts';
import { launch } from './helpers.ts';

// These controls alter only the running test window or a disposable executable.
// RED mode runs this same observer without expecting the rejection, so the
// command must fail. It is selected only by the separate red config.
export async function exerciseControl(
  kind: 'node' | 'inline' | 'network',
  red = false,
) {
  // Renderer capability and CSP controls do not need imported archive rows.
  const app = await launch('probe', false);
  let contacted = 0;
  const probe =
    kind === 'network'
      ? createServer((_request, response) => {
          contacted++;
          response.end('generated');
        })
      : undefined;
  try {
    if (probe)
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(4643, '127.0.0.1', resolve);
      });
    const events = await test.step('install policy observer', () =>
      observePolicy(app.page));
    await test.step('reload controlled app page', () => app.page.reload());
    await test.step('wait for reloaded interactive navigation', () =>
      expect(
        app.page.getByRole('navigation', { name: 'SocialPrune' }),
      ).toBeVisible());
    if (kind === 'node') {
      await test.step('plant Node decoy', () =>
        app.page.evaluate(() =>
          Object.assign(window, { process: { generated: true } }),
        ));
      const planted = await test.step('read renderer capabilities', () =>
        rendererState(app.page));
      if (red) assertRenderer(planted);
      else expect(() => assertRenderer(planted)).toThrow();
    } else {
      await app.page.evaluate(async (control) => {
        if (control === 'network') {
          await fetch('http://127.0.0.1:4643/planted').catch(() => undefined);
        } else {
          const factory = Reflect.get(window, 'trustedTypes') as {
            createPolicy(
              name: string,
              rules: { createScript: (value: string) => string },
            ): { createScript(value: string): unknown };
          };
          const policy = factory.createPolicy('socialprune', {
            createScript: (value: string) => value,
          });
          const script = document.createElement('script');
          Reflect.set(
            script,
            'text',
            policy.createScript('window.plantedInline = true'),
          );
          document.head.append(script);
        }
      }, kind);
      await expect.poll(async () => (await events()).length).toBeGreaterThan(0);
      const observed = await events();
      expect(contacted).toBe(0);
      expect(
        observed.some(
          (event) =>
            event.directive ===
            (kind === 'network' ? 'connect-src' : 'script-src-elem'),
        ),
      ).toBe(true);
      expect(
        await app.page.evaluate(
          () => Reflect.get(window, 'plantedInline') as unknown,
        ),
      ).toBeUndefined();
      if (red) assertPolicyEvents(observed, app.requests);
      else
        expect(() => assertPolicyEvents(observed, app.requests)).toThrow(
          'CSP_VIOLATION',
        );
    }
  } finally {
    if (probe?.listening)
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    await app.close();
  }
}

for (const kind of ['node', 'inline', 'network'] as const)
  test(`positive control catches planted ${kind}`, async () =>
    exerciseControl(kind));

test('both fuse maps are exact and a changed fuse is caught', async () => {
  await assertFuses(executable('release'), false);
  await assertFuses(executable('test'), true);
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-fuse-control-'));
  try {
    const altered = join(temp, 'SocialPrune.exe');
    await cp(executable('test'), altered);
    await flipFuses(altered, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
    });
    await expect(assertFuses(altered, true)).rejects.toThrow('FUSE_MISMATCH_0');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
