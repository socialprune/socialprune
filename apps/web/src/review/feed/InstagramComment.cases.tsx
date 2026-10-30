import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { expect, test, vi } from 'vitest';
import { catalogs } from '../../i18n/index.ts';
import { FeedCard } from './FeedCard.tsx';
import type { FeedCardModel } from './types.ts';
import { InstagramPost } from '../../social/InstagramPost.tsx';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import type { InstagramContext } from '@socialprune/core';
import { commentText } from './InstagramComment.tsx';
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: vi.fn(actual.useState) };
});

const card: FeedCardModel = {
  id: 'generated-parity',
  name: 'Taylor',
  handle: 'demo_taylor',
  createdAt: '2024-01-31T12:00:00Z',
  text: 'An invented council remark.',
  mediaCount: 0,
  kind: 'post',
  likes: null,
  reposts: 0,
  suggestions: [],
  heldBy: [],
  decision: 'undecided',
};
test('Instagram comment display separates only a leading mention run and preserves the source', () => {
  const text =
    '@generated.one @generated_two Own words retain @inside and the ending.';
  expect(commentText(text)).toEqual({
    own: 'Own words retain @inside and the ending.',
    mentions: '@generated.one @generated_two',
  });
  expect(commentText('@generated.one ')).toEqual({
    own: '@generated.one ',
    mentions: '',
  });
  expect(
    commentText('@this_handle_is_longer_than_thirty_characters Body'),
  ).toEqual({
    own: '@this_handle_is_longer_than_thirty_characters Body',
    mentions: '',
  });
  for (const single of [false, true]) {
    const html = render(
      <FeedCard
        card={{ ...card, kind: 'comment', text }}
        platform="instagram"
        single={single}
        position={1}
        total={1}
        onDecision={() => undefined}
      />,
      'en',
    );
    const primary = html.match(
      /<p[^>]*data-primary-text="true"[^>]*>([\s\S]*?)<\/p>/,
    )?.[1];
    expect(primary).toBe(
      single
        ? 'Own words retain @inside and the ending.'
        : `<strong id="${html.match(/<strong id="([^"]+)"/)?.[1]}" dir="ltr">demo_taylor</strong> ${text}`,
    );
    expect(html).toContain('@generated.one @generated_two');
  }
  expect(text).toBe(
    '@generated.one @generated_two Own words retain @inside and the ending.',
  );
});

for (const locale of ['de', 'en'] as const)
  test(`REPLIES-1 replies follow the own Instagram comment in ${locale}, empty differs from unobserved and X is unchanged`, () => {
    const replies = {
      entries: [
        {
          account: 'generated_reply',
          text: 'Generated reply <script>not executed</script>',
          createdAt: '2025-01-02T12:00:00Z',
          likes: { count: 7, source: 'dom' as const },
        },
      ],
      moreCount: 1,
      capped: false,
    };
    const node = (value: FeedCardModel, platform: 'x' | 'instagram') => (
      <FeedCard
        card={value}
        platform={platform}
        position={1}
        total={1}
        onDecision={() => undefined}
      />
    );
    const html = render(
      node({ ...card, kind: 'comment', replies }, 'instagram'),
      locale,
    );
    expect(html.indexOf(card.text)).toBeLessThan(
      html.indexOf('generated_reply'),
    );
    expect(html).toContain('data-instagram-replies');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('2025-01-02T12:00:00Z');
    expect(
      render(
        node(
          {
            ...card,
            kind: 'comment',
            replies: { entries: [], moreCount: 0, capped: false },
          },
          'instagram',
        ),
        locale,
      ),
    ).toContain(catalogs[locale]['instagramReplies.empty']);
    expect(
      render(node({ ...card, kind: 'comment' }, 'instagram'), locale),
    ).not.toContain('data-instagram-replies');
    expect(render(node({ ...card, replies }, 'x'), locale)).not.toContain(
      'generated_reply',
    );
  });
for (const locale of ['de', 'en'] as const)
  for (const mode of ['feed-fallback', 'feed-action', 'full'] as const)
    test(`expanded screenshot control says hide in ${locale}, ${mode}`, () => {
      const record: InstagramContext = instagramContractRecord();
      if (mode === 'feed-fallback')
        record.image = { file: null, host: null, status: 'not-captured' };
      const state = vi
        .mocked(React.useState)
        .mockImplementationOnce(() => [true, () => undefined]);
      try {
        const html = render(
          <InstagramPost
            record={record}
            variant={mode === 'full' ? 'full' : 'feed'}
          />,
          locale,
        );
        expect(html).toContain('aria-expanded="true"');
        expect(html).toMatch(/aria-controls="[^"]+"/);
        expect(html).toContain(
          locale === 'de' ? 'Screenshot ausblenden' : 'Hide screenshot',
        );
        expect(html).not.toContain(
          `>${catalogs[locale]['instagramContext.showScreenshot']}</button>`,
        );
      } finally {
        state.mockReset();
      }
    });
test.each(['en', 'de'] as const)(
  'Instagram post header precedes full-width media, caption and evidence in %s',
  (locale) => {
    const record = instagramContractRecord();
    record.post.caption = 'Generated full-width caption.';
    const html = render(
      <InstagramPost record={record} variant="feed" />,
      locale,
    );
    expect(html.indexOf('data-instagram-post-header')).toBeGreaterThan(-1);
    expect(html.indexOf('data-instagram-post-header')).toBeLessThan(
      html.indexOf('<img'),
    );
    expect(html.indexOf('<img')).toBeLessThan(
      html.indexOf('Generated full-width caption.'),
    );
    expect(html.indexOf('Generated full-width caption.')).toBeLessThan(
      html.indexOf('<details'),
    );
    expect(html).toContain('data-instagram-post-avatar');
    const css = readFileSync(
      new URL('../../social/InstagramPost.module.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(/\.feedImage\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.feedImage\s*\{[^}]*max-width:\s*470px/s);
    expect(css).toMatch(/\.feedImage\s*\{[^}]*height:\s*auto/s);
    expect(css).toMatch(
      /\.feedAvatar\s*\{[^}]*border:\s*var\(--border-width\)/s,
    );
  },
);
test.each(['en', 'de'] as const)(
  'Instagram comment metadata avoids the duplicated kind and conditionally hides the owner in %s',
  (locale) => {
    const html = render(
      <FeedCard
        card={{ ...card, kind: 'comment', replyTo: 'generated_owner' }}
        platform="instagram"
        position={1}
        total={1}
        onDecision={() => undefined}
      />,
      locale,
    );
    expect(html).not.toContain(
      `<span>${catalogs[locale]['review.comment']}</span>`,
    );
    expect(html).toContain('data-instagram-owner');
    expect(html).toContain('generated_owner');
    const css = readFileSync(
      new URL('./InstagramComment.module.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(
      /\.content:has\(\[data-testid='instagram-post'\]\)\s*\[data-instagram-owner\]\s*\{\s*display:\s*none/s,
    );
  },
);
test.each(['en', 'de'] as const)(
  'FIT-1 preserves X content, evidence, rule and decision state through the new hierarchy in %s',
  (locale) => {
    for (const kind of ['post', 'reply', 'quote', 'repost'] as const)
      for (const decision of [
        'undecided',
        'keep',
        'later',
        'delete',
      ] as const) {
        const model: FeedCardModel = {
          ...card,
          kind,
          decision,
          mediaCount: 2,
          likes: 14,
          replyTo: 'invented_parent',
          replyContext:
            kind === 'reply'
              ? [{ ...card, id: 'parent', text: 'Generated parent text.' }]
              : undefined,
          quote:
            kind === 'quote'
              ? { ...card, id: 'quoted', text: 'Generated quoted text.' }
              : undefined,
          suggestions: [
            {
              id: 'generated-hint',
              category: 'Political',
              level: 2,
              source: { kind: 'example' },
              reason: 'Generated reason.',
              evidence: 'council',
            },
          ],
          heldBy: [
            { id: 'generated-rule', value: '14', rule: 'Generated rule' },
          ],
        };
        const props = {
          card: model,
          position: 2,
          total: 4,
          platform: 'x' as const,
          onDecision: () => undefined,
        };
        const current = render(<FeedCard {...props} />, locale);
        const suggestionIcon =
          /<svg\b[^>]*class="lucide lucide-wand-sparkles[^"]*"[^>]*>[\s\S]*?<\/svg>/gu;
        expect(current.match(suggestionIcon)).toHaveLength(1);
        expect(current).toContain(`data-decision="${decision}"`);
        expect(current).toContain('<mark>council</mark>');
        expect(current).toContain('Generated rule');
        expect(current).toContain(
          locale === 'en'
            ? '<strong>Suggestion: delete</strong> · Political · Medium · Example'
            : '<strong>Vorschlag: löschen</strong> · Political · Mittel · Beispiel',
        );
        expect(current).toContain('>Generated reason.</p>');
        expect(current).toMatch(
          /<details[^>]*><summary>[^<]+<\/summary>[\s\S]*?Example|<details[^>]*><summary>[^<]+<\/summary>[\s\S]*?Beispiel/,
        );
      }
  },
);
test.each(['en', 'de'] as const)(
  'each X and Instagram suggestion keeps its 16px hidden mark before its label in %s',
  (locale) => {
    for (const platform of ['x', 'instagram'] as const)
      for (const decision of [
        'undecided',
        'keep',
        'later',
        'delete',
      ] as const) {
        const html = render(
          <FeedCard
            card={{
              ...card,
              kind: platform === 'instagram' ? 'comment' : 'post',
              decision,
              suggestions: [
                {
                  id: 'delete',
                  category: 'Political',
                  level: 2,
                  source: { kind: 'example' },
                  reason: 'Generated reason.',
                },
                {
                  id: 'unclear',
                  category: 'Unclear',
                  level: 1,
                  source: { kind: 'example' },
                  reason: 'Generated uncertainty.',
                  unclear: true,
                },
                {
                  id: 'harmless',
                  category: 'Harmless',
                  level: 0,
                  source: { kind: 'example' },
                  reason: 'Generated harmless example.',
                  harmless: true,
                },
              ],
            }}
            platform={platform}
            position={1}
            total={1}
            onDecision={() => undefined}
          />,
          locale,
        );
        const marks = html.match(
          /<svg\b[^>]*class="lucide lucide-wand-sparkles[^"]*"[^>]*>[\s\S]*?<\/svg>(?=<p dir="auto"><strong>)/gu,
        );
        expect(marks).toHaveLength(3);
        for (const mark of marks ?? []) {
          expect(mark).toContain('width="16"');
          expect(mark).toContain('height="16"');
          expect(mark).toContain('aria-hidden="true"');
        }
      }
  },
);
function render(node: React.ReactNode, locale: 'en' | 'de') {
  return renderToStaticMarkup(
    createElement(IntlProvider, {
      locale,
      messages: catalogs[locale],
      children: node,
    }),
  );
}
test.each(['en', 'de'] as const)(
  'FIT-1 X metadata and focal text stay present with unchanged decision keys in %s',
  (locale) => {
    const html = render(
      <FeedCard
        card={card}
        position={1}
        total={1}
        platform="x"
        onDecision={() => undefined}
      />,
      locale,
    );
    expect(html).toContain('data-primary-text');
    expect(html).toContain(card.text);
    expect(html).toContain('<kbd>K</kbd>');
    expect(html).toContain('<kbd>L</kbd>');
    expect(html).toContain('<kbd>M</kbd>');
    expect(html).toContain(locale === 'en' ? '0 reposts' : '0 Reposts');
  },
);

test.each(['en', 'de'] as const)(
  'feed keeps the owner-not-exported evidence and gates a stored screenshot behind its control in %s',
  (locale) => {
    const record: InstagramContext = instagramContractRecord();
    record.ownerCheck = 'not-in-export';
    record.image = { file: null, host: null, status: 'not-captured' };
    const html = render(
      <InstagramPost record={record} variant="feed" />,
      locale,
    );
    expect(html).not.toContain(`<img`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(catalogs[locale]['instagramContext.showScreenshot']);
    expect(html).toContain(
      locale === 'en'
        ? 'The export names no post account'
        : 'Der Export nennt kein Beitragskonto',
    );
    expect(html).not.toContain(
      locale === 'en'
        ? 'the post&#x27;s account match your export'
        : 'das Konto des Beitrags stimmen mit deinem Export',
    );
  },
);

test.each(['en', 'de'] as const)(
  'feed explains list confirmation without claiming a comment ID in %s',
  (locale) => {
    const record = instagramContractRecord();
    const list = {
      ...record,
      confirmedBy: 'list' as const,
      ownerCheck: 'matched-export' as const,
      comment: { id: null, createdAt: null, expandClicks: 0 },
    };
    const html = render(<InstagramPost record={list} variant="feed" />, locale);
    expect(html).toContain(
      locale === 'en'
        ? 'no comment ID was recorded'
        : 'keine Kommentar-ID gespeichert',
    );
    expect(html).toContain(
      locale === 'en'
        ? 'The list opened this post'
        : 'Die Liste hat diesen Beitrag geöffnet',
    );
  },
);

test.each(['en', 'de'] as const)(
  'Instagram comment puts stored media/caption above inline username/text without phantom engagement in %s',
  (locale) => {
    const record = instagramContractRecord();
    record.post.caption = 'Generated garden caption.';
    const html = render(
      <FeedCard
        card={{ ...card, kind: 'comment', replyTo: record.post.owner }}
        platform="instagram"
        position={1}
        total={1}
        context={<InstagramPost record={record} variant="feed" />}
        onDecision={() => undefined}
      />,
      locale,
    );
    expect(html.indexOf('Generated garden caption.')).toBeLessThan(
      html.indexOf('An invented council remark.'),
    );
    expect(html).toContain('data-instagram-comment');
    expect(html).toContain('/image.jpg');
    expect(html).toMatch(
      /<strong[^>]+dir="ltr">demo_taylor<\/strong> An invented council remark\./,
    );
    expect(html).toContain('data-mark-action');
    expect(html).toContain('<kbd>K</kbd>');
    expect(html).toContain('<kbd>L</kbd>');
    expect(html).toContain('<kbd>M</kbd>');
    expect(html).not.toContain(locale === 'en' ? 'Likes:' : 'Gefällt mir:');
    expect(html).not.toMatch(/reposts|Reposts/);
    expect(html).not.toContain(catalogs[locale]['proto.instagramMissingPost']);
  },
);

test.each(['en', 'de'] as const)(
  'Instagram missing-post state stays honest, escaped and retains hold/mark actions in %s',
  (locale) => {
    const html = render(
      <FeedCard
        card={{
          ...card,
          kind: 'comment',
          text: '<script>invented()</script>',
          heldBy: [
            {
              id: 'generated-date',
              value: '2024',
              rule: 'Generated date rule',
            },
          ],
        }}
        platform="instagram"
        position={1}
        total={1}
        onDecision={() => undefined}
      />,
      locale,
    );
    expect(html).toContain(catalogs[locale]['proto.instagramMissingPost']);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Generated date rule');
    expect(html).toContain(
      locale === 'en' ? 'Mark anyway' : 'Trotzdem vormerken',
    );
    expect(html).not.toContain('instagram-post');
    expect(html).not.toMatch(/reposts|Reposts|Likes:|Gefällt mir:/);
  },
);
