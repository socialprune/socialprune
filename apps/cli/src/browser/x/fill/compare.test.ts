import { expect, test } from 'vitest';
import * as comparison from './compare.ts';
import { extract } from './extract.ts';
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../../originals/test/detail.ts';

const DISPLAY_FIXTURE = {
  mention: '@generated_reply ',
  encoded:
    'Generated &amp; decoded visit https://t.co/generatedLink and final emoji 😀',
  visible:
    'Generated & decoded visit https://t.co/generatedLink and final emoji 😀',
  mediaUrl: 'https://t.co/generatedMedia',
  renderedLink: 'example.org/generated',
};
const fullText =
  DISPLAY_FIXTURE.mention +
  DISPLAY_FIXTURE.encoded +
  ' ' +
  DISPLAY_FIXTURE.mediaUrl;
const range = [
  Array.from(DISPLAY_FIXTURE.mention).length,
  Array.from(DISPLAY_FIXTURE.mention + DISPLAY_FIXTURE.encoded).length,
];
const answerPost = () => ({
  ...detailPost(),
  legacy: {
    ...detailPost().legacy,
    full_text: fullText,
    display_text_range: range,
    entities: { media: [{ url: DISPLAY_FIXTURE.mediaUrl }] },
  },
});

test('focal display text uses code-point range, decoded entities and media URL removal without changing persisted full text', () => {
  const result = extract(detailAnswer(answerPost()), DETAIL_FIXTURE.id, {
    instruction: null,
  });
  expect(result.kind).toBe('read');
  if (result.kind !== 'read')
    throw new Error('Generated focal post was not read.');
  expect(Reflect.get(result, 'displayText')).toBe(DISPLAY_FIXTURE.visible);
  expect(result.post.text).toBe(fullText);
  expect(result.post.signedInRecord?.text).toBe(fullText);
  expect(Reflect.has(result.post, 'displayText')).toBe(false);
});

test('display range indices count Unicode code points, not UTF-16 units', () => {
  const post = {
    ...detailPost(),
    legacy: {
      ...detailPost().legacy,
      full_text: '😀Hidden visible 🐈 end',
      display_text_range: [8, 17],
    },
  };
  const result = extract(detailAnswer(post), DETAIL_FIXTURE.id, {
    instruction: null,
  });
  expect(result.kind).toBe('read');
  expect(Reflect.get(result, 'displayText')).toBe('visible 🐈');
});

test('missing or malformed display ranges fall back to full decoded text and remove every named media URL occurrence', () => {
  const project = comparison.displayTextFromAnswer;
  const text =
    'Generated &lt;label&gt; ' +
    DISPLAY_FIXTURE.mediaUrl +
    ' tail ' +
    DISPLAY_FIXTURE.mediaUrl;
  for (const display_text_range of [
    undefined,
    null,
    [0],
    [-1, 4],
    [3, 2],
    [0, 9999],
    [0, 1.5],
    ['0', '4'],
    [0, 2, 4],
  ]) {
    expect(
      project({
        legacy: {
          full_text: text,
          display_text_range,
          entities: { media: [{ url: DISPLAY_FIXTURE.mediaUrl }] },
        },
      }),
    ).toBe('Generated <label>  tail ');
  }
});

test('note display text is decoded as full note text, never sliced by a legacy range', () => {
  const result = extract(
    detailAnswer({
      ...answerPost(),
      note_tweet: {
        note_tweet_results: {
          result: { text: 'Generated &quot;long note&quot; 😀 &#x661f; tail' },
        },
      },
    }),
    DETAIL_FIXTURE.id,
    { instruction: null },
  );
  expect(result.kind).toBe('read');
  expect(Reflect.get(result, 'displayText')).toBe(
    'Generated "long note" 😀 星 tail',
  );
});

test('display entity decoding is one pass, covers named and numeric forms, and preserves invalid scalar values', () => {
  const decode = comparison.decodeDisplayEntities;
  expect(
    decode('  &amp; &lt; &gt; &quot; &#39; &apos; &#x661f; &#128512;\n'),
  ).toBe("  & < > \" ' ' 星 😀\n");
  expect(decode('&amp;lt; &nbsp; &unknown; &#0; &#xD800; &#1114112;')).toBe(
    '&lt; &nbsp; &unknown; &#0; &#xD800; &#1114112;',
  );
});

test('image-alt reconciliation removes each observed sequence once in order and compares exact remaining text', () => {
  const compare = comparison.compareDisplayText;
  const stored = 'Generated & decoded final emoji 😀';
  const shown = 'Generated & decoded final emoji ';
  const result = compare(stored, shown, ['😀']);
  expect(result.matches).toBe(true);
  expect(result.storedLength).toBe(stored.length);
  expect(result.shownLength).toBe(stored.length);
  expect(result.text).toMatchObject({
    storedPlainLength: shown.trim().length,
    shownInnerTextLength: shown.trim().length,
    imageAltUnits: 2,
    matchedImageAlts: 1,
  });
  expect(
    compare('Generated 😀 🐈 tail', 'Generated   tail', ['😀', '🐈']).matches,
  ).toBe(true);
  for (const [value, alts] of [
    ['Generated 😀', ['🐈']],
    ['Generated 🐈 😀 tail', ['😀', '🐈']],
    ['Generated 😀 tail', ['😀', '😀']],
    ['Generated 😀 tail', [null]],
  ] as const) {
    expect(compare(value, 'Generated tail', [...alts]).matches).toBe(false);
  }
  expect(
    compare('Generated missing', 'Generated missing tail', []).matches,
  ).toBe(false);
  expect(
    compare('Generated same size A', 'Generated same size B', []).matches,
  ).toBe(false);
});

test('generated 76-unit legacy answer compares its 52-unit display slice with 50-unit innerText plus one two-unit image emoji', () => {
  const innerText = 'Generated photo caption with a cheerful last word ';
  const full = innerText + '😀 https://t.co/generatedx';
  expect(innerText.length).toBe(50);
  expect(full.length).toBe(76);
  expect(Array.from(full)).toHaveLength(75);
  const result = extract(
    detailAnswer({
      ...detailPost(),
      legacy: {
        ...detailPost().legacy,
        full_text: full,
        display_text_range: [0, 51],
        entities: { media: [{ url: 'https://t.co/generatedx' }] },
      },
    }),
    DETAIL_FIXTURE.id,
    { instruction: null },
  );
  if (result.kind !== 'read')
    throw new Error('Generated focal post was not read.');
  expect(result.displayText.length).toBe(52);
  expect(
    comparison.compareDisplayText(result.displayText, innerText, ['😀']),
  ).toEqual({
    storedLength: 52,
    shownLength: 52,
    matches: true,
    text: {
      storedPlainLength: 49,
      shownInnerTextLength: 49,
      imageAltUnits: 2,
      matchedImageAlts: 1,
      imageSpacingUnits: 1,
    },
  });
  expect(result.post.text).toBe(full);
});

test('the note branch keeps its decoded note text even if a legacy media URL also appears there', () => {
  expect(
    comparison.displayTextFromAnswer({
      ...answerPost(),
      note_tweet: {
        note_tweet_results: {
          result: { text: 'Generated note &amp; ' + DISPLAY_FIXTURE.mediaUrl },
        },
      },
    }),
  ).toBe('Generated note & ' + DISPLAY_FIXTURE.mediaUrl);
});

test('card and quoted permalink removal candidates stay transient and exclude all unrelated link entities', () => {
  const cardUrl = 'https://t.co/generatedCard';
  const quoteUrl = 'https://t.co/generatedQuote';
  const focal = {
    ...detailPost(),
    card: {
      rest_id: 'generated-card-record',
      legacy: {
        url: cardUrl,
        name: 'summary',
        binding_values: [
          {
            key: 'card_url',
            value: { string_value: 'https://t.co/generatedFallback' },
          },
        ],
      },
    },
    legacy: {
      ...detailPost().legacy,
      full_text: 'Generated caption ' + cardUrl + ' ' + quoteUrl,
      quoted_status_permalink: {
        url: quoteUrl,
        expanded: 'https://example.org/generated-quote',
        display: 'example.org/generated-quote',
      },
      entities: { urls: [{ url: 'https://t.co/generatedOther' }] },
    },
  };
  const result = extract(detailAnswer(focal), DETAIL_FIXTURE.id, {
    instruction: null,
  });
  expect(result.kind).toBe('read');
  if (result.kind !== 'read')
    throw new Error('Generated focal post was not read.');
  expect(Reflect.get(result, 'displayLinks')).toEqual([cardUrl, quoteUrl]);
  expect(result.displayText).toBe(
    'Generated caption ' + cardUrl + ' ' + quoteUrl,
  );
  expect(Reflect.has(result.post, 'displayLinks')).toBe(false);
  expect(Reflect.has(result.post.signedInRecord!, 'card')).toBe(false);
});

test('card URL extraction falls back only to the card_url string binding and prefers a direct URL', () => {
  const candidates = comparison.displayLinksFromAnswer;
  const card = {
    legacy: {
      binding_values: [
        {
          key: 'image_original',
          value: { string_value: 'https://t.co/generatedImage' },
        },
        {
          key: 'card_url',
          value: { string_value: 'https://t.co/generatedBoundCard' },
        },
        { key: 'title', value: { string_value: 'Generated title' } },
      ],
    },
  };
  expect(
    candidates({
      card,
      legacy: { entities: { urls: [{ url: 'https://t.co/generatedOther' }] } },
    }),
  ).toEqual(['https://t.co/generatedBoundCard']);
  expect(
    candidates({
      __typename: 'TweetWithVisibilityResults',
      tweet: {
        card: {
          legacy: { ...card.legacy, url: 'https://t.co/generatedDirectCard' },
        },
        legacy: {
          quoted_status_permalink: { url: 'https://t.co/generatedQuote' },
        },
      },
    }),
  ).toEqual([
    'https://t.co/generatedDirectCard',
    'https://t.co/generatedQuote',
  ]);
  expect(
    candidates({
      card: {
        legacy: {
          binding_values: [
            {
              key: 'other_url',
              value: { string_value: 'https://t.co/generatedOther' },
            },
          ],
        },
      },
    }),
  ).toEqual([]);
});

test('only unrendered card and permalink links are removed, and a rendered or unrelated link remains in the display text', () => {
  const remove = comparison.removeUnrenderedDisplayLinks;
  const card = 'https://t.co/generatedCard',
    quote = 'https://t.co/generatedQuote',
    other = 'https://t.co/generatedOther';
  const text = 'Generated ' + card + ' ' + quote + ' ' + other;
  expect(remove(text, [card, quote], [])).toBe('Generated   ' + other);
  expect(remove(text, [card, quote], [card])).toBe(
    'Generated ' + card + '  ' + other,
  );
  expect(remove(text, [card, quote], [card, quote])).toBe(text);
  expect(remove('Generated omitted rendered link', [card], [card])).toBe(
    'Generated omitted rendered link',
  );
});

test('a gated focal expects zero shown photos and players even when older media files are stored', () => {
  const media = [
    { kind: 'photo', status: 'stored' },
    { kind: 'video', status: 'stored' },
    { kind: 'gif', status: 'not-stored' },
  ];
  expect(comparison.expectedFocalMediaCounts(media, true)).toEqual({
    photos: 0,
    videos: 0,
  });
  expect(comparison.expectedFocalMediaCounts(media, false)).toEqual({
    photos: 1,
    videos: 2,
  });
});
