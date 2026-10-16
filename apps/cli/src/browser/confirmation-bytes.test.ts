import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { startConfirmation } from './confirmation.ts';
import type { ConfirmationView } from './confirmation-state.ts';

test('all confirmation page and view bytes match the pre-split server for every rendered phase and language', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-confirmation-baseline-'));
  // Read the frozen pre-split implementation, not expectations from the split.
  const source = execFileSync(
    'git',
    [
      '--no-pager',
      'show',
      '1d5bcfd124ed0075b428b8a0ab39e4bfcbffb9da:apps/cli/src/browser/confirmation.ts',
    ],
    { cwd: import.meta.dirname, encoding: 'utf8', windowsHide: true },
  );
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
