import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';
import {
  contextInputs,
  writeContextFixture,
} from '../../cli/src/review/test/context-fixture.ts';

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
