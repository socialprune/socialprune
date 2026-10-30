import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';
import {
  contextInputs,
  writeContextFixture,
} from '../../cli/src/review/test/context-fixture.ts';
import { SQLiteStore } from '../../cli/src/workspace/sqlite-store.ts';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { readWorkspace } from '@socialprune/core/workspace/store';

test('REPLIES-1 CLI to real IndexedDB to CLI backup preserves replies and v11 upgrade invents none', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspace = await mkdtemp(join(tmpdir(), 'sp-replies-roundtrip-'));
  let store: SQLiteStore | undefined;
  let target: SQLiteStore | undefined;
  try {
    const fixture = await writeContextFixture(workspace);
    store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'));
    const record = fixture.data.instagramContext![0]!;
    const replies = {
      entries: [
        {
          account: 'generated_roundtrip',
          text: 'Generated local reply for the portable round trip',
          createdAt: null,
          likes: { count: 9, source: 'dom' as const },
        },
      ],
      moreCount: 0,
      capped: false,
    };
    await store.write((tx) =>
      tx.instagramContext.fillReplies({ ...record, replies }),
    );
    let source = '';
    for await (const bytes of createBackup(store).chunks)
      source += new TextDecoder().decode(bytes);
    await store.close();
    store = undefined;
    await waitForApp(page);
    expect(
      await page.evaluate(
        (text) =>
          window.workspace.request({
            type: 'restore',
            requestId: crypto.randomUUID(),
            file: new File([text], 'generated-replies.json'),
          }),
        source,
      ),
    ).toMatchObject({ type: 'opened' });
    const backup = await page.evaluate(async () => {
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      return text;
    });
    const roundtrip = JSON.parse(
      backup,
    ) as import('@socialprune/core').WorkspaceV2;
    expect(roundtrip.schemaVersion).toBe(12);
    expect(
      roundtrip.instagramContext!.find(
        (value) => value.itemId === record.itemId,
      )?.replies,
    ).toEqual(replies);
    target = await SQLiteStore.open(join(workspace, 'roundtrip.sqlite'), {
      initial: (
        await import('@socialprune/core/workspace/store')
      ).createWorkspace(),
    });
    await restoreBackup(
      target,
      (async function* () {
        await Promise.resolve();
        yield backup;
      })(),
    );
    expect(
      (await target.read(readWorkspace)).instagramContext!.find(
        (value) => value.itemId === record.itemId,
      )?.replies,
    ).toEqual(replies);
    // This generated v11 portable input has no replies. Restore upgrades its
    // version only; no empty observation is invented.
    const legacy = JSON.parse(
      source,
    ) as import('@socialprune/core').WorkspaceV2;
    legacy.schemaVersion = 11;
    for (const context of legacy.instagramContext!) delete context.replies;
    expect(
      await page.evaluate(
        (text) =>
          window.workspace.request({
            type: 'restore',
            requestId: crypto.randomUUID(),
            file: new File([text], 'generated-v11.json'),
          }),
        JSON.stringify(legacy),
      ),
    ).toMatchObject({ type: 'opened' });
    const observed = await page.evaluate(async () => {
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
    });
    expect(
      observed.instagramContext!.every(
        (context) => context.replies === undefined,
      ),
    ).toBe(true);
  } finally {
    await store?.close();
    await target?.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('C10 v5 backup restores as post and real IndexedDB v5 upgrade rewrites every context without changing other stores', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspace = await mkdtemp(join(tmpdir(), 'socialprune-ig8-idb-'));
  try {
    const { data } = await writeContextFixture(workspace);
    const legacy = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    legacy.schemaVersion = 5;
    delete legacy.reviewPlans;
    delete (legacy.counts as Record<string, unknown>).reviewPlans;
    const settings = legacy.settings as Record<string, unknown>;
    delete settings.criteria;
    delete settings.keepRules;
    if (settings.review)
      delete (settings.review as Record<string, unknown>).feed;
    for (const record of legacy.submissions as Record<string, unknown>[])
      delete record.criteria;
    for (const record of legacy.instagramContext as Record<string, unknown>[]) {
      delete record.confirmedBy;
      delete record.ownerCheck;
    }
    await waitForApp(page);
    expect(
      await page.evaluate(
        (text) =>
          window.workspace.request({
            type: 'restore',
            requestId: crypto.randomUUID(),
            file: new File([text], 'generated-v5.json'),
          }),
        JSON.stringify(legacy),
      ),
    ).toMatchObject({ type: 'opened' });
    const before = await page.evaluate(async () => {
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
    });
    expect(before.schemaVersion).toBe(12);
    expect(
      before.instagramContext!.every(
        (record) =>
          record.confirmedBy === 'post' &&
          record.ownerCheck === 'matched-export',
      ),
    ).toBe(true);
    const id = await page.evaluate(async () => {
      const open = (name: string, version?: number) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(
              request.error ?? new Error('Generated database open failed.'),
            );
        });
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(
              request.error ?? new Error('Generated database read failed.'),
            );
        });
      const done = (tx: IDBTransaction) =>
        new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () =>
            reject(
              tx.error ?? new Error('Generated database transaction aborted.'),
            );
        });
      const registry = await open('sp-registry');
      const active = (await read(
        registry.transaction('pointers').objectStore('pointers').get('active'),
      )) as string;
      window.workspace.dispose();
      const source = await open('sp-ws-' + active);
      const stores = await Promise.all(
        [...source.objectStoreNames]
          .filter((name) => name !== 'reviewPlans')
          .map(async (name) => {
            const store = source.transaction(name).objectStore(name);
            const [values, keys] = await Promise.all([
              read(store.getAll()),
              read(store.getAllKeys()),
            ]);
            return {
              name,
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
              indexes: [...store.indexNames].map((index) => {
                const value = store.index(index);
                return {
                  name: index,
                  keyPath: value.keyPath,
                  unique: value.unique,
                  multiEntry: value.multiEntry,
                };
              }),
              values,
              keys,
            };
          }),
      );
      source.close();
      const id = 'generated-v5-' + crypto.randomUUID();
      const request = indexedDB.open('sp-ws-' + id, 5);
      request.onupgradeneeded = () => {
        for (const definition of stores) {
          const store = request.result.createObjectStore(definition.name, {
            keyPath: definition.keyPath,
            autoIncrement: definition.autoIncrement,
          });
          for (const index of definition.indexes)
            store.createIndex(index.name, index.keyPath, index);
        }
      };
      const old = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ??
              new Error('Generated database fixture open failed.'),
          );
      });
      const tx = old.transaction(
        stores.map((store) => store.name),
        'readwrite',
      );
      for (const definition of stores)
        for (const [index, input] of definition.values.entries()) {
          const value = structuredClone(input) as Record<string, unknown>;
          if (
            definition.name === 'meta' &&
            definition.keys[index] === 'workspace'
          ) {
            value.schemaVersion = 5;
            const settings = value.settings as Record<string, unknown>;
            delete settings.criteria;
            delete settings.keepRules;
            if (settings.review)
              delete (settings.review as Record<string, unknown>).feed;
          }
          if (definition.name === 'submissions') delete value.criteria;
          if (definition.name === 'instagramContext') {
            delete value.confirmedBy;
            delete value.ownerCheck;
          }
          const store = tx.objectStore(definition.name);
          if (store.keyPath === null) store.put(value, definition.keys[index]);
          else store.put(value);
        }
      await done(tx);
      if (old.version !== 5)
        throw new Error('Generated v5 physical fixture was not created.');
      old.close();
      const pointer = registry.transaction(
        ['workspaces', 'pointers'],
        'readwrite',
      );
      pointer
        .objectStore('workspaces')
        .put({ id, kind: 'personal', createdAt: new Date().toISOString() });
      pointer.objectStore('pointers').put(id, 'active');
      await done(pointer);
      registry.close();
      return id;
    });
    await page.reload();
    await waitForApp(page);
    const after = await page.evaluate(async (id) => {
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      const request = indexedDB.open('sp-ws-' + id);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ??
              new Error('Generated database upgraded open failed.'),
          );
      });
      const version = db.version;
      db.close();
      return {
        version,
        workspace: JSON.parse(text) as import('@socialprune/core').WorkspaceV2,
      };
    }, id);
    expect(after.version).toBe(12);
    expect(after.workspace.instagramContext).toEqual(before.instagramContext);
    expect(after.workspace.items).toEqual(before.items);
    expect(after.workspace.browserRuns).toEqual(before.browserRuns);
    expect(after.workspace.browserAttempts).toEqual(before.browserAttempts);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Pages retains backed-up Instagram context but shows only each existing fallback under the real network audit', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const workspace = await mkdtemp(join(tmpdir(), 'socialprune-pages-context-'));
  try {
    const { data } = await writeContextFixture(workspace);
    const audit = await observeImport(context, page);
    const requestedFiles: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/context/'))
        requestedFiles.push(request.url());
    });
    await waitForApp(page);
    const reply = await page.evaluate(
      (text) =>
        window.workspace.request({
          type: 'restore',
          requestId: crypto.randomUUID(),
          file: new File([text], 'generated-context-backup.json'),
        }),
      JSON.stringify(data),
    );
    expect(reply.type).toBe('opened');
    expect(
      await page.evaluate(
        async (id) => window.workspace.getInstagramContext([id]),
        contextInputs.items[0]!.id,
      ),
    ).toEqual([]);
    await page.goto('/socialprune/#/review');
    const card = page.getByTestId('review-card');
    await page.getByRole('tab', { name: /^All,/ }).click();
    await expect(card).toContainText('Instagram does not include the post.');
    await expect(page.getByTestId('instagram-post')).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByTestId('app-menu')
      .getByRole('link', { name: 'List view', exact: true })
      .click();
    const grid = page.getByRole('grid');
    const ownRow = grid
      .getByRole('row')
      .filter({ hasText: contextInputs.items[0]!.text });
    await expect(ownRow).toBeVisible();
    await ownRow.dblclick();
    await expect(
      page.getByRole('region', { name: 'Entry details' }),
    ).toContainText('The post this comment is on is not part of your export.');
    await page.goto('/socialprune/#/archive');
    await expect(page.getByTestId('archive')).toBeVisible();
    await expect(page.locator('article').first()).toContainText(
      'Instagram does not include the post.',
    );
    const decided = await page.evaluate(
      async (itemId) =>
        window.workspace.request({
          type: 'decide',
          requestId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          itemIds: [itemId],
          expected: { [itemId]: 'undecided' },
          value: 'delete',
        }),
      contextInputs.items[0]!.id,
    );
    expect(decided.type).toBe('committed');
    await page.goto('/socialprune/#/clicklist/instagram/go');
    await expect(page.getByTestId('delete-card')).toContainText(
      'Instagram does not include the post.',
    );
    await expect(page.getByTestId('instagram-post')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Open on Instagram', exact: true }),
    ).toHaveCount(0);
    const saved = await page.evaluate(async () => {
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      return JSON.parse(text) as import('@socialprune/core').WorkspaceV2;
    });
    const byItem = (records: NonNullable<typeof saved.instagramContext>) =>
      records.toSorted((a, b) => a.itemId.localeCompare(b.itemId));
    expect(byItem(saved.instagramContext!)).toEqual(
      byItem(data.instagramContext!),
    );
    expect(requestedFiles).toEqual([]);
    await audit.assert();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
