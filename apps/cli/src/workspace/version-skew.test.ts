import { expect, test } from 'vitest';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from './sqlite-store.ts';
import { createWorkspace } from '@socialprune/core/workspace/store';
import { createBackup } from '@socialprune/core/workspace/backup';

test('D10 unchanged real open/backup checks with the version-9 ceiling refuse version 10 before data changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-version-skew-'));
  const file = join(directory, 'socialprune.sqlite');
  try {
    const current = await SQLiteStore.open(file, {
      initial: createWorkspace(),
    });
    let text = '';
    try {
      for await (const bytes of createBackup(current).chunks)
        text += new TextDecoder().decode(bytes);
    } finally {
      await current.close();
    }
    expect((JSON.parse(text) as { schemaVersion: number }).schemaVersion).toBe(
      10,
    );
    // Test-only build of the real guards with the old maximum. No production
    // entrypoint or runtime setting can select this transform.
    const seen = new Set<string>();
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'generated-version-eight-ceiling-only',
          enforce: 'pre',
          transform(source, id) {
            const path = id.replaceAll('\\', '/');
            const name = path.endsWith('/model/index.ts')
              ? 'WORKSPACE_SCHEMA_VERSION'
              : path.endsWith('/workspace/sqlite-store.ts')
                ? 'SQLITE_LAYOUT_VERSION'
                : null;
            if (!name) return null;
            const before = `export const ${name} = 10;`;
            if (source.split(before).length !== 2)
              throw new Error('Version-skew test ceiling source changed');
            seen.add(name);
            return {
              code: source.replace(before, `export const ${name} = 9;`),
              map: null,
            };
          },
        },
      ],
      build: {
        ssr: true,
        write: false,
        minify: false,
        lib: {
          entry: {
            store: fileURLToPath(new URL('./sqlite-store.ts', import.meta.url)),
            backup: fileURLToPath(
              new URL(
                '../../../../packages/core/src/workspace/backup.ts',
                import.meta.url,
              ),
            ),
          },
          formats: ['es'],
        },
      },
    });
    expect([...seen].sort()).toEqual([
      'SQLITE_LAYOUT_VERSION',
      'WORKSPACE_SCHEMA_VERSION',
    ]);
    const result = Array.isArray(output) ? output[0] : output;
    if (!result || !('output' in result))
      throw new Error('Compatibility build missing');
    let storeEntry = '',
      backupEntry = '';
    for (const chunk of result.output) {
      if (chunk.type !== 'chunk') continue;
      await writeFile(join(directory, chunk.fileName), chunk.code, {
        flag: 'wx',
      });
      if (chunk.isEntry && chunk.name === 'store') storeEntry = chunk.fileName;
      if (chunk.isEntry && chunk.name === 'backup')
        backupEntry = chunk.fileName;
    }
    const oldStore = (await import(
      /* @vite-ignore */ pathToFileURL(join(directory, storeEntry)).href
    )) as { SQLiteStore: typeof SQLiteStore };
    const oldBackup = (await import(
      /* @vite-ignore */ pathToFileURL(join(directory, backupEntry)).href
    )) as {
      readBackup: typeof import('@socialprune/core/workspace/backup').readBackup;
    };
    const before = await readFile(file);
    for (const readOnly of [false, true])
      await expect(
        oldStore.SQLiteStore.open(file, { readOnly }),
      ).rejects.toMatchObject({ code: 'WORKSPACE_SCHEMA_UNSUPPORTED' });
    expect(await readFile(file)).toEqual(before);
    const chunks = () =>
      (async function* () {
        await Promise.resolve();
        yield text;
      })();
    await expect(oldBackup.readBackup(chunks())).rejects.toMatchObject({
      code: 'BACKUP_SCHEMA_UNSUPPORTED',
    });
    // Positive controls: the same old guards accept an otherwise equal v8 file
    // and portable document. A generic broken compatibility build cannot pass.
    const raw = new DatabaseSync(file);
    raw.exec(
      "UPDATE meta SET data=json_set(data,'$.schemaVersion',9); PRAGMA user_version=9;",
    );
    raw.close();
    const accepted = await oldStore.SQLiteStore.open(file, { readOnly: true });
    await accepted.close();
    const legacy = JSON.parse(text) as { schemaVersion: number };
    legacy.schemaVersion = 9;
    await expect(
      oldBackup.readBackup(
        (async function* () {
          await Promise.resolve();
          yield JSON.stringify(legacy);
        })(),
      ),
    ).resolves.toMatchObject({ schemaVersion: 9 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
