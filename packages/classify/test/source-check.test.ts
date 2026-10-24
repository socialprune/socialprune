import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseSource, sourceConfigurationHash } from '../src/config.ts';
import { loadSourceConfig, recordSourceCheck } from '../src/node.ts';

test('record check atomically replaces valid JSON without key bytes and refuses changed or aborted inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-source-check-'));
  const path = join(directory, 'source.json');
  try {
    const config = parseSource({
      schemaVersion: 1,
      name: 'generated',
      baseUrl: 'http://127.0.0.1:44000/v1',
      model: 'generated-model',
      entriesPerRequest: 5,
      keyFile: 'generated.key',
    });
    const raw = JSON.stringify(config) + '\n';
    await writeFile(path, raw);
    await writeFile(join(directory, 'generated.key'), 'GENERATED_KEY_BYTES');
    const check = {
      origin: 'http://127.0.0.1:44000',
      answeringModel: 'generated-model',
      rubricVersion: '123456789abc',
      checkedAt: '2026-10-24T01:00:00.000Z',
      configurationHash: sourceConfigurationHash(config),
    };
    await recordSourceCheck(path, config, check, new AbortController().signal);
    expect(await loadSourceConfig(path)).toEqual({ ...config, check });
    expect(await readFile(path, 'utf8')).not.toContain('GENERATED_KEY_BYTES');
    expect((await readdir(directory)).sort()).toEqual([
      'generated.key',
      'source.json',
    ]);
    await expect(
      recordSourceCheck(path, config, check, new AbortController().signal),
    ).rejects.toThrow('SOURCE_FILE_INVALID');
    const before = await readFile(path, 'utf8');
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      recordSourceCheck(
        path,
        await loadSourceConfig(path),
        check,
        cancelled.signal,
      ),
    ).rejects.toThrow('RUN_STOPPED');
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('configuration identity excludes only check metadata; check parser rejects malformed and unknown fields', () => {
  const config = parseSource({
    schemaVersion: 1,
    name: 'generated',
    baseUrl: 'http://127.0.0.1:44000/v1',
    model: 'generated-model',
    entriesPerRequest: 5,
  });
  const check = {
    origin: 'http://127.0.0.1:44000',
    answeringModel: 'generated-model',
    rubricVersion: '123456789abc',
    checkedAt: '2026-10-24T01:00:00.000Z',
    configurationHash: sourceConfigurationHash(config),
  };
  expect(sourceConfigurationHash({ ...config, check })).toBe(
    sourceConfigurationHash(config),
  );
  expect(sourceConfigurationHash({ ...config, model: 'another' })).not.toBe(
    sourceConfigurationHash(config),
  );
  for (const bad of [
    { ...check, key: 'forbidden' },
    { ...check, answeringModel: '' },
    { ...check, checkedAt: 'not-a-time' },
    { ...check, rubricVersion: 'unknown' },
  ])
    expect(() => parseSource({ ...config, check: bad })).toThrow(
      'SOURCE_FILE_INVALID',
    );
});
