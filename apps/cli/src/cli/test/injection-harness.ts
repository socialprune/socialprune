import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect } from 'vitest';
import { executeCli } from '../adapter.ts';
import type { CliContext } from '../context.ts';
import { capturedContext } from './context.ts';
import { CliResultSchema } from '../schemas.ts';

export const injectionArchive = fileURLToPath(
  new URL(
    '../../../../../fixtures/synthetic/x/injection/archive/',
    import.meta.url,
  ),
);

export async function injectionInput() {
  const raw = await Promise.all(
    ['tweets', 'account', 'manifest'].map((name) =>
      readFile(join(injectionArchive, 'data', `${name}.js`), 'utf8'),
    ),
  );
  // Values come from the fixture, not the redaction or error implementation.
  // Short enum/numeric strings can coincide with the fixed wire protocol.
  const forbidden = new Set<string>();
  for (const text of raw) {
    for (const match of text.matchAll(/:\s*("(?:[^"\\]|\\.)*")/g)) {
      const value: unknown = JSON.parse(match[1]!);
      if (typeof value === 'string' && value.length >= 5) forbidden.add(value);
    }
  }
  const marker = raw[0]!.match(/globalThis\.([A-Za-z_$][\w$]*)\s*=/)?.[1];
  if (!marker) throw new Error('The fixture has no execution marker.');
  forbidden.add(marker);
  return { text: raw.join('\n'), forbidden: [...forbidden], marker };
}

export async function injectionData() {
  const raw = await readFile(
    join(injectionArchive, 'data', 'tweets.js'),
    'utf8',
  );
  const start = raw.indexOf('[{');
  const end = raw.lastIndexOf('];');
  const values: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(values) || !values.length)
    throw new Error('No fixture JSON data.');
  return values as { tweet: { full_text: string; [key: string]: unknown } }[];
}

export function assertNoPrivateDetails(
  envelope: unknown,
  forbidden: readonly string[],
): void {
  const serialized = JSON.stringify(envelope);
  for (const value of forbidden)
    if (value) expect(serialized).not.toContain(value);
  const result = CliResultSchema.parse(envelope);
  expect(result.status).toBe('error');
  if (result.status !== 'error') throw new Error('Expected failure.');
  expect(result.error).toMatchObject({ code: 'INVALID_LABELS' });
}

export function assertNoFixtureStrings(
  stdout: string,
  stderr: string,
  forbidden: readonly string[],
): void {
  for (const value of forbidden) {
    expect(stdout, `stdout leaked ${JSON.stringify(value)}`).not.toContain(
      value,
    );
    expect(stderr, `stderr leaked ${JSON.stringify(value)}`).not.toContain(
      value,
    );
  }
}

export interface FailingCommandCase {
  name: string;
  args: readonly string[];
  services: CliContext['services'];
  exitCode: number;
  nodeVersion?: string;
  envelope?: boolean;
  context?: Partial<CliContext>;
}

export async function assertFailureCases(
  cases: readonly FailingCommandCase[],
  forbidden: readonly string[],
): Promise<void> {
  for (const fixture of cases) {
    for (const json of [false, true]) {
      const capture = capturedContext(fixture.services);
      const code = await executeCli(
        [...fixture.args, ...(json ? ['--json'] : [])],
        {
          ...capture.context,
          ...fixture.context,
          ...(fixture.nodeVersion ? { nodeVersion: fixture.nodeVersion } : {}),
        },
      );
      expect(code, fixture.name).toBe(fixture.exitCode);
      assertNoFixtureStrings(
        capture.stdout.join(''),
        capture.stderr.join(''),
        forbidden,
      );
      expect(capture.opened, fixture.name).toEqual([]);
      if (json || fixture.envelope) {
        expect(capture.stdout, fixture.name).toHaveLength(1);
        expect(
          CliResultSchema.parse(JSON.parse(capture.stdout[0]!)),
          fixture.name,
        ).toMatchObject({ status: 'error' });
      } else expect(capture.stdout, fixture.name).toHaveLength(0);
    }
  }
}
