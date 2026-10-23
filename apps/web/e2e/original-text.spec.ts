import { expect, test } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';
import { reviewFixture } from './review-fixture.ts';
import {
  originalTextCases,
  originalTextInput,
} from './original-text-fixture.ts';

for (const row of originalTextCases()) {
  test(`${row.name} renders as text in review and archive without changing records`, async ({
    page,
    context,
  }) => {
    const audit = await observeImport(context, page);
    await waitForApp(page);
    const data = reviewFixture('personal', false, 2);
    const reply = data.items[0]!;
    reply.text = originalTextInput.ownText;
    reply.kind = 'reply';
    reply.reference.replyToId = row.original.id;
    const own = data.items[1]!;
    own.text = originalTextInput.ownText;
    const restored = await page.evaluate(
      (text) =>
        window.workspace.request({
          type: 'restore',
          requestId: crypto.randomUUID(),
          file: new File([text], 'generated-original-text.json'),
        }),
      JSON.stringify(data),
    );
    expect(restored.type).toBe('opened');
    // Browser-only storage deliberately returns no originals. Inject generated
    // records only in this test, at the same client port local review consumes.
    await page.evaluate(
      ({ original, ownItemId }) => {
        window.workspace.getOriginals = (ids) =>
          Promise.resolve(ids.includes(original.id) ? [original] : []);
        window.workspace.getConversation = () =>
          Promise.resolve({
            chain: [
              {
                id: '81002',
                original: { ...original, id: '81002' },
                ownItemId: null,
              },
              { id: '81003', original: null, ownItemId },
            ],
            state: 'complete',
          });
      },
      { original: row.original, ownItemId: own.id },
    );
    for (const route of ['review', 'archive']) {
      await page.goto(`/socialprune/#/${route}`);
      if (route === 'review')
        await page.getByRole('tab', { name: /^All,/ }).click();
      const card = page.locator(`article[data-item-id="${reply.id}"]`);
      await expect(card).toBeVisible();
      await expect(
        card
          .locator('p[dir="auto"]')
          .filter({
            hasText: originalTextInput.ownText,
          })
          .first(),
      ).toHaveText(originalTextInput.ownText);
      const original = card.getByTestId('stored-original');
      const text = original.locator(':scope > p[dir="auto"]').first();
      await expect(text).toHaveText(row.expected);
      for (const forbidden of row.hidden)
        await expect(text).not.toContainText(forbidden);
      await expect(text.locator('b, script')).toHaveCount(0);
      await expect(text).toContainText('<b>paper</b>');
      await expect(text).toHaveAttribute('dir', 'auto');
      if (!row.original.signedIn || row.original.signedIn.status === 'read') {
        await original.locator('summary').click();
        const chain = original.locator('details section');
        await expect(chain.first().locator('p[dir="auto"]')).toHaveText(
          row.expected,
        );
        await expect(chain.last().locator('p[dir="auto"]')).toHaveText(
          originalTextInput.ownText,
        );
        await expect(chain.locator('b, script')).toHaveCount(0);
      }
      expect(
        await page.evaluate(
          (id) => window.workspace.getOriginals([id]),
          row.original.id,
        ),
      ).toEqual([row.original]);
      const storedOwn = await page.evaluate(
        (itemId) =>
          window.workspace.request({
            type: 'detail',
            requestId: crypto.randomUUID(),
            itemId,
          }),
        reply.id,
      );
      expect(storedOwn.type).toBe('itemDetail');
      if (storedOwn.type !== 'itemDetail') throw new Error('Missing fixture');
      expect(storedOwn.item).toEqual(reply);
      expect(storedOwn.events).toEqual([]);
    }
    await audit.assert();
  });
}
