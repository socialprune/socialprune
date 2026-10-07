import { test, expect } from '@playwright/test';
import {
  fixtureZips,
  importFiles,
  waitForApp,
  workspaceIds,
} from './helpers.ts';

test('W1 corrupt restore leaves active data intact; valid streaming restore switches after validation', async ({
  page,
}) => {
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await waitForApp(page);
    await importFiles(page, fixture.files);
    const item = fixture.expected.items[0]!.id;
    const before = await page.evaluate(async (itemId) => {
      await window.workspace.request({
        type: 'decide',
        requestId: 'decision',
        commandId: 'backup-decision',
        itemIds: [itemId],
        value: 'keep',
        expected: { [itemId]: 'undecided' },
      });
      let text = '';
      await window.workspace.backup(async (file) => {
        text = await file.text();
      });
      const opened = await window.workspace.open();
      return {
        text,
        summary: opened.type === 'opened' ? opened.summary : null,
      };
    }, item);
    const backup = JSON.parse(before.text) as {
      lastBackupAt: string;
      items: { id: string }[];
    };
    expect(backup.items.map(({ id }) => id).sort()).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    expect(before.summary?.lastBackupAt).toBe(backup.lastBackupAt);
    const invalid = await page.evaluate(
      (text) =>
        window.workspace.request({
          type: 'restore',
          requestId: 'corrupt',
          file: new File([text.slice(0, -40)], 'invented-corrupt.json'),
        }),
      before.text,
    );
    expect(invalid).toMatchObject({ type: 'failed' });
    expect(await workspaceIds(page)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    const restored = await page.evaluate(
      (text) =>
        window.workspace.request({
          type: 'restore',
          requestId: 'valid',
          file: new File([text], 'invented-backup.json'),
        }),
      before.text,
    );
    expect(restored).toMatchObject({
      type: 'opened',
      summary: {
        lastBackupAt: backup.lastBackupAt,
        counts: { items: fixture.expected.items.length },
      },
    });
    expect(await workspaceIds(page)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    const detail = await page.evaluate(
      (itemId) =>
        window.workspace.request({
          type: 'detail',
          requestId: 'restored-detail',
          itemId,
        }),
      item,
    );
    expect(detail).toMatchObject({
      type: 'itemDetail',
      events: [{ itemId: item, value: 'keep' }],
    });
    expect(
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory().catch(() => null);
        if (!root) return [];
        const names: string[] = [];
        for await (const name of (
          root as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
        ).keys())
          names.push(name);
        return names.filter((name) => name.startsWith('sp-backup-'));
      }),
    ).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});
