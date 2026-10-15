import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { expect, test } from 'vitest';
import { InstagramPost } from './InstagramPost.tsx';
import { catalogs } from '../i18n/index.ts';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import { WorkspaceClient } from '../workspace/client.ts';
import { readFile } from 'node:fs/promises';
import type { Item } from '@socialprune/core';

test('context view renders caption and owner as text, builds links and keeps screenshots collapsed in both languages', () => {
  const record = instagramContractRecord();
  record.post.caption =
    '<img src="https://generated.invalid/caption" onerror="generated()">';
  for (const locale of ['en', 'de'] as const) {
    const html = renderToStaticMarkup(
      createElement(IntlProvider, {
        locale,
        messages: catalogs[locale],
        children: createElement(InstagramPost, { record, zone: 'UTC' }),
      }),
    );
    expect(html).toContain('dir="auto"');
    expect(html).toContain('&lt;img src=');
    expect(html).not.toContain('<img src="https://');
    expect(html).toContain(
      `href="https://www.instagram.com/p/${record.post.code}/"`,
    );
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('/shot.jpg');
    const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(record.confirmedAt));
    expect(html).toContain(
      catalogs[locale]['instagramContext.found']
        .replace('{date}', date)
        .replaceAll("'", '&#x27;'),
    );
  }
});

test('RED CONTROL forbidden values from a second fixture account fail on the view without the identity wrapper', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/instagram/two-accounts/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: Item[] };
  const foreign = fixture.items[1]!,
    record = instagramContractRecord(foreign);
  record.post.caption = foreign.text;
  const forbidden = [foreign.text, foreign.reference.ownerHandle!];
  const html = renderToStaticMarkup(
    createElement(IntlProvider, {
      locale: 'en',
      messages: catalogs.en,
      children: createElement(InstagramPost, { record }),
    }),
  );
  expect(() => {
    for (const value of forbidden) expect(html).not.toContain(value);
  }).toThrow();
});

test('client uses the bounded canonical request and correlates the reply without silently accepting another reply type', async () => {
  const target = new EventTarget();
  const worker = Object.assign(target, {
    postMessage(message: unknown) {
      const input = message as {
        type: string;
        requestId: string;
        itemIds: string[];
      };
      expect(input).toMatchObject({
        type: 'getInstagramContext',
        itemIds: [instagramContractRecord().itemId],
      });
      target.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'instagramContext',
            requestId: input.requestId,
            records: [],
          },
        }),
      );
    },
    terminate() {},
  });
  const client = new WorkspaceClient(worker);
  expect(
    await client.getInstagramContext([instagramContractRecord().itemId]),
  ).toEqual([]);
  await expect(client.getInstagramContext(['x:101'])).rejects.toThrow();
  await expect(client.getInstagramContext([])).rejects.toThrow();
  client.dispose();
});
