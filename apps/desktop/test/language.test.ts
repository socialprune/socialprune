import { mkdtemp, readFile, readdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { writeLanguage } from '../src/main/language.ts';
import { lockLanguageFile } from './language-lock.ts';

test.skipIf(process.platform !== 'win32')(
  'a transient deny-delete reader must not discard the only write of the latest locale',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-language-retry-'));
    let unlock: (() => Promise<void>) | undefined;
    try {
      await writeLanguage(root, 'de');
      unlock = await lockLanguageFile(join(root, 'ui-language.json'));
      const release = delay(250).then(() => unlock!());
      const result = await writeLanguage(root, 'en').then(
        () => ({ state: 'saved' }),
        (error: unknown) => ({
          state: 'failed',
          code:
            error && typeof error === 'object' && 'code' in error
              ? error.code
              : null,
        }),
      );
      await release;
      console.log('LANGUAGE_NATIVE_REPLACE', JSON.stringify(result));
      expect(result).toEqual({ state: 'saved' });
      expect(await readFile(join(root, 'ui-language.json'), 'utf8')).toBe(
        '"en"',
      );
      expect(await readdir(root)).toEqual(['ui-language.json']);
    } finally {
      await unlock?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('an ordinary Node poll reader can contend with replacement until its handle closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-language-reader-'));
  let reader;
  try {
    await writeLanguage(root, 'de');
    reader = await open(join(root, 'ui-language.json'), 'r');
    const read = reader;
    const release = delay(250).then(() => read.close());
    const saving = writeLanguage(root, 'en');
    expect(await read.readFile('utf8')).toBe('"de"');
    await release;
    reader = undefined;
    await saving;
    expect(await readFile(join(root, 'ui-language.json'), 'utf8')).toBe('"en"');
  } finally {
    await reader?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'permanent replacement denial is bounded, retains the old name, records its cause and allows a later write',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-language-denial-'));
    let unlock: (() => Promise<void>) | undefined;
    const events: string[] = [];
    try {
      await writeLanguage(root, 'de');
      unlock = await lockLanguageFile(join(root, 'ui-language.json'));
      await expect(
        writeLanguage(root, 'en', (code) => events.push(code)),
      ).rejects.toMatchObject({ code: 'EPERM' });
      expect(events).toEqual([
        ...Array<string>(5).fill('LANGUAGE_REPLACE_RETRY_EPERM'),
        'LANGUAGE_WRITE_REPLACE_EPERM',
      ]);
      expect(await readFile(join(root, 'ui-language.json'), 'utf8')).toBe(
        '"de"',
      );
      expect(await readdir(root)).toEqual(['ui-language.json']);
      await unlock();
      await writeLanguage(root, 'en');
      expect(await readFile(join(root, 'ui-language.json'), 'utf8')).toBe(
        '"en"',
      );
    } finally {
      await unlock?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);
