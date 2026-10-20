import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { dist, root } from './paths.ts';
import { failureRecord } from '../e2e/proof-failure.ts';
import { controlOutputExcerpt } from './diagnostic-output.ts';

async function boundedRead(path: string) {
  try {
    const file = await open(path, 'r');
    try {
      const bytes = Buffer.alloc(65_536);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      return bytes
        .subarray(0, bytesRead)
        .toString('utf8')
        .replace(/^\uFEFF/, '');
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}

// Called by the parent before a unit test's finally removes its run root.
// Keep a path-redacted causal record in the existing release-*.json upload,
// including startup stderr when Node fails before the TS receipt writer loads.
export async function preserveLimitedProofFailure(
  report: string,
  error: unknown,
  destination = dist,
) {
  const paths = { repo: root, temp: dirname(report), home: homedir() };
  const scrub = (value: unknown, depth = 0): unknown => {
    if (depth > 8) return '<depth-limit>';
    if (typeof value === 'string')
      return controlOutputExcerpt(value, paths).join('\n').slice(0, 4000);
    if (Array.isArray(value))
      return value.slice(0, 100).map((item) => scrub(item, depth + 1));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 100)
          .map(([name, item]) => [name, scrub(item, depth + 1)]),
      );
    return value;
  };
  const json = async (path: string) => {
    const text = await boundedRead(path);
    if (text === null) return { state: 'missing' };
    try {
      return scrub(JSON.parse(text) as unknown);
    } catch {
      return {
        state: 'invalid-json',
        excerpt: controlOutputExcerpt(text, paths),
      };
    }
  };
  const record = {
    version: 1,
    state: 'failed',
    parent: failureRecord(error, root, dirname(report)),
    token: await json(report),
    profile: await json(report + '.profile.json'),
    startup: controlOutputExcerpt(
      (await boundedRead(report + '.profile.json.stderr.txt')) ?? '',
      paths,
    ),
    stdout: controlOutputExcerpt(
      (await boundedRead(report + '.profile.json.stdout.txt')) ?? '',
      paths,
    ),
  };
  await mkdir(destination, { recursive: true });
  const output = join(
    destination,
    `release-limited-proof-${randomUUID()}.json`,
  );
  await writeFile(output, JSON.stringify(record, null, 2));
  console.error('LIMITED_PROOF_CAUSE', JSON.stringify(record));
  return output;
}
