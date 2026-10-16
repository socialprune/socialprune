import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { startConfirmation } from './confirmation.ts';
import type { ConfirmationView } from './confirmation-state.ts';

// SHA-256 of the unmodified confirmation.ts blob at pre-split commit 1d5bcfd.
const BASELINE_SHA256 =
  '14aac1b61f976331a619f616bb61d737f9cf3e0f7117078fd24341875eb79b8d';
function frozenSource(bytes: Buffer): string {
  expect(
    createHash('sha256').update(bytes).digest('hex'),
    'Frozen pre-split confirmation fixture changed',
  ).toBe(BASELINE_SHA256);
  return bytes.toString('utf8');
}
const fixture = new URL('./confirmation-baseline.fixture.txt', import.meta.url);

test('the frozen confirmation baseline rejects a one-character change', async () => {
  const bytes = await readFile(fixture);
  frozenSource(bytes);
  const changed = Buffer.from(bytes);
  changed[0] = 'I'.charCodeAt(0);
  expect(() => frozenSource(changed)).toThrow(
    'Frozen pre-split confirmation fixture changed',
  );
});

test('all confirmation page and view bytes match the pre-split server for every rendered phase and language', async () => {
  // Read the frozen pre-split implementation, not expectations from the split.
  const source = frozenSource(await readFile(fixture));
  const directory = await mkdtemp(join(tmpdir(), 'sp-confirmation-baseline-'));
  const baseline = source.replace(
    /from '(\.[^']+)'/g,
    (_match: string, specifier: string) =>
      `from '${new URL(specifier, import.meta.url).href}'`,
  );
  const path = join(directory, 'confirmation-baseline.ts');
  await writeFile(path, baseline);
  const old = (await import(pathToFileURL(path).href)) as {
    startConfirmation: typeof startConfirmation;
  };
  try {
    for (const platform of ['x', 'instagram'] as const)
      for (const lang of ['en', 'de'] as const) {
        const initial = {
          phase: 'start',
          platform,
          lang,
          expectedHandle: 'generated_account',
          warning: 'Generated warning',
          profileWarning: 'Generated profile',
          planned: 5,
          marked: 3,
          bulk: 2,
          estimateMs: 120000,
          list: 'generated-list',
          rows: [{ firstLine: 'Generated line', action: 'read-post' }],
          completed: 0,
          result: 'Generated start',
        } satisfies Omit<ConfirmationView, 'version'>;
        const servers = await Promise.all([
          old.startConfirmation(initial),
          startConfirmation(initial),
        ]);
        try {
          const sessions = await Promise.all(
            servers.map(async (server) => {
              const response = await fetch(server.url + 'session', {
                method: 'POST',
                headers: {
                  Origin: new URL(server.url).origin,
                  'Content-Type': 'application/json',
                  'X-SocialPrune-Bootstrap': new URL(
                    server.launchUrl,
                  ).hash.split('=')[1]!,
                },
                body: '{}',
              });
              const result = (await response.json()) as { csrf: string };
              return {
                Cookie: response.headers.get('set-cookie')!.split(';')[0]!,
                'X-SocialPrune-CSRF': result.csrf,
              };
            }),
          );
          for (const phase of [
            'start',
            'running',
            'canary',
            'match',
            'ended',
          ] as const) {
            for (const server of servers)
              server.update({ phase, result: `Generated ${phase}` });
            for (const resource of [
              '',
              'confirmation.css',
              'confirmation.js',
              'api/view',
            ]) {
              const bytes = await Promise.all(
                servers.map(async (server, index) => {
                  const response = await fetch(
                    server.url + resource,
                    resource === 'api/view'
                      ? {
                          method: 'POST',
                          headers: {
                            ...sessions[index]!,
                            Origin: new URL(server.url).origin,
                            'Content-Type': 'application/json',
                          },
                          body: '{}',
                        }
                      : {},
                  );
                  expect(response.status).toBe(200);
                  return Buffer.from(await response.arrayBuffer());
                }),
              );
              expect(bytes[1]!.equals(bytes[0]!)).toBe(true);
            }
          }
        } finally {
          await Promise.all(servers.map((server) => server.close()));
        }
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
