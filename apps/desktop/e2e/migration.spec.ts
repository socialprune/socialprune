import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { launch, call } from './helpers.ts';

test('pinned packaged utility copies a layout-4 database before migration and queries its unchanged demo', async () => {
  let before: Buffer | undefined;
  const app = await launch('test', true, async (data) => {
    const file = join(data, 'workspace/socialprune.sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec(
        "DROP TABLE instagram_context; PRAGMA user_version=4; UPDATE meta SET data=json_set(data,'$.schemaVersion',4);",
      );
    } finally {
      db.close();
    }
    before = await readFile(file);
  });
  try {
    await expect(app.page.getByTestId('review-card')).toBeVisible();
    expect(
      await call(app, {
        type: 'open',
        requestId: 'migration-open',
        workspaceId: 'local',
      }),
    ).toMatchObject({
      type: 'reviewReply',
      replies: [
        {
          type: 'opened',
          summary: { counts: { items: 300 }, decisions: { undecided: 300 } },
        },
      ],
    });
    const directory = join(app.data, 'workspace');
    const copies = (await readdir(directory)).filter((name) =>
      name.endsWith('.before-migration.sqlite'),
    );
    expect(copies).toHaveLength(1);
    expect(await readFile(join(directory, copies[0]!))).toEqual(before);
    const db = new DatabaseSync(join(directory, 'socialprune.sqlite'), {
      readOnly: true,
    });
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
      expect(
        db.prepare('SELECT count(*) AS total FROM items').get()?.total,
      ).toBe(300);
      expect(
        db.prepare('SELECT count(*) AS total FROM instagram_context').get()
          ?.total,
      ).toBe(0);
    } finally {
      db.close();
    }
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
