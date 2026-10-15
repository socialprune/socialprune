import { expect, test } from 'vitest';
import * as comparison from './compare.ts';
import { extract } from './extract.ts';
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../../originals/test/detail.ts';
import {
  noticeAlignmentAnswer,
  NOTICE_ALIGNMENT_FIXTURE,
  statusEntityAnswer,
  STATUS_ENTITY_FIXTURE,
} from '../../../../e2e/fake-x/fill-detail.ts';

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

test('R5 legacy status entities require exact in-range URL text, allowed HTTPS status paths and bounded indices', () => {
  const body = statusEntityAnswer(DETAIL_FIXTURE.id);
  const content =
    body.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries[0]!.content;
  if (!('itemContent' in content)) throw new Error('Generated focal absent.');
  const post = content.itemContent.tweet_results.result as ReturnType<
    typeof detailPost
  >;
  expect(comparison.statusEntitiesFromAnswer(post)).toEqual([
    { url: STATUS_ENTITY_FIXTURE.url, path: STATUS_ENTITY_FIXTURE.path },
  ]);
  expect(
    comparison.statusEntitiesFromAnswer({
      __typename: 'TweetWithVisibilityResults',
      tweet: post,
    }),
  ).toEqual([
    { url: STATUS_ENTITY_FIXTURE.url, path: STATUS_ENTITY_FIXTURE.path },
  ]);
  const legacy = post.legacy as typeof post.legacy & {
    display_text_range: number[];
    entities: {
      urls: { url: string; expanded_url: string; indices: number[] }[];
    };
  };
  const entity = legacy.entities.urls[0]!;
  for (const host of [
    'x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
  ]) {
    entity.expanded_url = `https://${host}/GENERATED_STATUS/STATUS/901/`;
    expect(comparison.statusEntitiesFromAnswer(post)).toEqual([
      { url: STATUS_ENTITY_FIXTURE.url, path: STATUS_ENTITY_FIXTURE.path },
    ]);
  }
  for (const expanded of [
    'http://x.com/generated_status/status/901',
    'https://x.com.evil.example/generated_status/status/901',
    'https://x.com/generated_status',
    'https://x.com/generated_status/status/901/photo/1',
    'https://u@x.com/generated_status/status/901',
    'https://x.com/generated_status/status/901?x=1',
    'https://x.com/generated_status/status/901#x',
  ]) {
    entity.expanded_url = expanded;
    expect(comparison.statusEntitiesFromAnswer(post)).toEqual([]);
  }
  entity.expanded_url = STATUS_ENTITY_FIXTURE.expanded;
  const originalIndices = [...entity.indices];
  for (const indices of [
    [-1, 2],
    [0, 0],
    [0, 2],
    [0, 999],
    [1.5, 2],
  ]) {
    entity.indices = indices;
    expect(comparison.statusEntitiesFromAnswer(post)).toEqual([]);
  }
  entity.indices = originalIndices;
  legacy.display_text_range = [0, 3];
  expect(comparison.statusEntitiesFromAnswer(post)).toEqual([]);
  legacy.display_text_range = [0, 999];
  expect(comparison.statusEntitiesFromAnswer(post)).toEqual([]);
});

test('R5 each rendered status entity substitutes its own label on each exact basis and ambiguous anchors cannot match', () => {
  const fixture = STATUS_ENTITY_FIXTURE;
  const text = fixture.prefix + fixture.url;
  const links = [
    {
      href: '/GENERATED_STATUS/STATUS/901/',
      innerText: 'https:// ' + fixture.label,
      textContent: 'https://' + fixture.label,
    },
  ];
  const entities = [{ url: fixture.url, path: fixture.path }];
  const compare = (
    shown: string,
    content: string,
    rendered = links,
    mapped = entities,
    displayLinks: string[] = [],
  ) =>
    comparison.compareDisplayTextBases(
      text,
      shown,
      content,
      rendered,
      [],
      displayLinks,
      mapped,
    );
  expect(
    compare(
      fixture.prefix + links[0]!.innerText,
      fixture.prefix + links[0]!.textContent,
    ),
  ).toMatchObject({ matches: true, textBasis: 'innerText' });
  expect(
    compare(
      fixture.prefix + links[0]!.textContent,
      fixture.prefix + links[0]!.textContent,
    ),
  ).toMatchObject({ matches: true, textBasis: 'textContent' });
  expect(
    compare(
      fixture.prefix + links[0]!.innerText,
      fixture.prefix + links[0]!.textContent,
      links,
      entities,
      [fixture.url],
    ).matches,
  ).toBe(true);
  for (const rendered of [
    [...links, ...links],
    [{ ...links[0]!, href: '/generated_status/status/902' }],
  ])
    expect(
      compare(
        fixture.prefix + links[0]!.innerText,
        fixture.prefix + links[0]!.textContent,
        rendered,
      ),
    ).toMatchObject({ matches: false, textBasis: 'none' });
  expect(
    compare(
      fixture.prefix + links[0]!.innerText,
      fixture.prefix + links[0]!.textContent,
      links,
      [...entities, ...entities],
    ),
  ).toMatchObject({ matches: false, textBasis: 'none' });
  expect(
    compare(
      'Generated missing word ' + links[0]!.innerText,
      'Generated missing word ' + links[0]!.textContent,
    ).matches,
  ).toBe(false);
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

test('two focal text bases remain exact, prefer innerText and report lengths for the chosen basis', () => {
  const compare = comparison.compareDisplayTextBases;
  expect(
    compare(
      'Generated@mentiontail',
      'Generated @mention tail',
      'Generated@mentiontail',
      [],
      [],
    ),
  ).toMatchObject({
    matches: true,
    textBasis: 'textContent',
    storedLength: 21,
    shownLength: 21,
    text: {
      storedPlainLength: 21,
      shownInnerTextLength: 23,
      shownTextContentLength: 21,
    },
  });
  expect(
    compare(
      'Generated same text',
      'Generated same text',
      'Generated same text',
      [],
      [],
    ),
  ).toMatchObject({ matches: true, textBasis: 'innerText' });
  expect(
    compare(
      'Generated visible text',
      'Generated visible text',
      'Generated hidden prefix visible text',
      [],
      [],
    ),
  ).toMatchObject({
    matches: true,
    textBasis: 'innerText',
    storedLength: 22,
    shownLength: 22,
  });
  expect(
    compare(
      'Generated different A',
      'Generated different B',
      'Generated different C',
      [],
      [],
    ),
  ).toMatchObject({ matches: false, textBasis: 'none' });
  expect(
    compare(
      'Generated missing tail',
      'Generated tail',
      'Generated tail',
      [],
      [],
    ),
  ).toMatchObject({
    matches: false,
    textBasis: 'none',
    storedLength: 22,
    shownLength: 14,
  });
  expect(
    compare(
      'Generatedmissingtail',
      'Generated missing tail',
      'Generated missing tail',
      [],
      [],
    ),
  ).toMatchObject({ matches: false, textBasis: 'none' });
});

test('t.co anchor substitutions use each basis own label including hidden prefix spans and never admit a missing stored link', () => {
  const url = 'https://t.co/generatedLayout';
  const links = [
    { href: url, innerText: 'example.org', textContent: 'https://example.org' },
  ];
  const compare = comparison.compareDisplayTextBases;
  expect(
    compare(
      'Generated' + url + 'tail',
      'Generated example.org tail',
      'Generatedhttps://example.orgtail',
      links,
      [],
    ),
  ).toMatchObject({
    matches: true,
    textBasis: 'textContent',
    storedLength: 'Generatedhttps://example.orgtail'.length,
    shownLength: 'Generatedhttps://example.orgtail'.length,
    text: {
      shownInnerTextLength: 'Generated example.org tail'.length,
      shownTextContentLength: 'Generatedhttps://example.orgtail'.length,
    },
  });
  expect(
    compare(
      'Generatedtail',
      'Generated example.org tail',
      'Generatedhttps://example.orgtail',
      links,
      [],
    ),
  ).toMatchObject({ matches: false, textBasis: 'none' });
  expect(
    compare(
      'Generated' + url + 'tail',
      'Generatedhttps://example.orgtail',
      'Generated example.org tail',
      links,
      [],
    ),
  ).toMatchObject({ matches: false, textBasis: 'none' });
});

test('both text bases reconcile image alts in the same order without admitting wrong or repeated images', () => {
  const compare = comparison.compareDisplayTextBases;
  expect(
    compare(
      'Generated@mention😀tail',
      'Generated @mention tail',
      'Generated@mentiontail',
      [],
      ['😀'],
    ),
  ).toMatchObject({
    matches: true,
    textBasis: 'textContent',
    storedLength: 23,
    shownLength: 23,
    text: { imageAltUnits: 2, matchedImageAlts: 1 },
  });
  for (const alts of [['🐈'], ['😀', '😀'], [null]])
    expect(
      compare(
        'Generated@mention😀tail',
        'Generated @mention tail',
        'Generated@mentiontail',
        [],
        alts,
      ).textBasis,
    ).toBe('none');
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

test.each([
  {
    name: 'delayed photo',
    expected: { text: 1, photos: 1, videos: 0 },
    states: [
      [0, 1, 0, 0],
      [1500, 1, 1, 0],
    ],
    end: 2500,
    settled: true,
  },
  {
    name: 'delayed text',
    expected: { text: 1, photos: 1, videos: 0 },
    states: [
      [0, 0, 1, 0],
      [1500, 1, 1, 0],
    ],
    end: 2500,
    settled: true,
  },
  {
    name: 'missing photo',
    expected: { text: 1, photos: 1, videos: 0 },
    states: [[0, 1, 0, 0]],
    end: 10000,
    settled: false,
  },
  {
    name: 'late gated player',
    expected: { text: 1, photos: 0, videos: 0 },
    states: [
      [0, 1, 0, 0],
      [1500, 1, 0, 1],
    ],
    end: 10000,
    settled: false,
  },
  {
    name: 'stable zero media',
    expected: { text: 1, photos: 0, videos: 0 },
    states: [[0, 1, 0, 0]],
    end: 2000,
    settled: true,
  },
  {
    name: 'media change resets settle',
    expected: { text: 1, photos: 1, videos: 0 },
    states: [
      [0, 1, 1, 0],
      [1500, 1, 0, 0],
      [2100, 1, 1, 0],
    ],
    end: 3100,
    settled: true,
  },
  {
    name: 'equal counts too near deadline',
    expected: { text: 1, photos: 1, videos: 0 },
    states: [
      [0, 1, 0, 0],
      [9500, 1, 1, 0],
    ],
    end: 10000,
    settled: false,
  },
])(
  'bounded focal count wait: $name',
  async ({ expected, states, end, settled }) => {
    let now = 0;
    const read = async () => {
      const state = states.findLast((state) => state[0]! <= now)!;
      return Promise.resolve({
        text: state[1]!,
        photos: state[2]!,
        videos: state[3]!,
      });
    };
    const result = await comparison.waitForFocalCounts(read, expected, {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
        await Promise.resolve();
      },
    });
    expect(now).toBe(end);
    expect(result.settled).toBe(settled);
    expect(result.counts).toEqual(await read());
  },
);

test('a locator count read returning after the fixed deadline cannot accept even unchanged expected counts', async () => {
  let now = 0;
  const counts = { text: 1, photos: 1, videos: 0 };
  const result = await comparison.waitForFocalCounts(
    async () => {
      if (now >= 100) now = 10_001;
      return Promise.resolve(counts);
    },
    counts,
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        await Promise.resolve();
      },
    },
  );
  expect(result).toEqual({ counts, settled: false });
});

test('tombstone notice text requires the full normalized answer including the link, without language matching', () => {
  const match = comparison.tombstoneNoticeMatches;
  const answer = 'Generated protected notice. Learn more';
  expect(match('  Generated\nprotected\tnotice.\n Learn more  ', answer)).toBe(
    true,
  );
  expect(
    match('Generated extra heading ' + answer + ' Generated footer', answer),
  ).toBe(true);
  expect(match('Generated protected notice.', answer)).toBe(false);
  expect(match('Generated different notice. Learn more', answer)).toBe(false);
  expect(match('This Post was deleted by the Post author.', answer)).toBe(
    false,
  );
  expect(match(answer, '')).toBe(false);
  expect(match(answer, ' \n\t')).toBe(false);
  const long = 'Generated long context. '.repeat(30) + answer;
  expect(match(long.slice(0, 500) + 'Generated changed tail', long)).toBe(
    false,
  );
  expect(match(long, long)).toBe(true);
});

test.each(['direct', 'replace', 'module', 'wrapped'])(
  'full focal tombstone text stays transient and selects the exact %s entry',
  (kind) => {
    const text =
      'Generated protected context. '.repeat(24) + 'Generated link text';
    const notice = {
      __typename: 'TweetTombstone',
      tombstone: { __typename: 'TextTombstone', text: { text } },
    };
    const result =
      kind === 'wrapped'
        ? { __typename: 'TweetWithVisibilityResults', tweet: notice }
        : notice;
    const body = detailAnswer(result, [detailPost('901')]);
    const instruction =
      body.data.threaded_conversation_with_injections_v2.instructions[0]!;
    if (kind === 'replace') {
      Object.assign(instruction, {
        type: 'TimelineReplaceEntry',
        entry: instruction.entries[1],
      });
    }
    if (kind === 'module') {
      instruction.entries[1] = {
        entryId: 'conversationthread-910',
        content: {
          items: [
            {
              entryId: `conversationthread-910-tweet-${DETAIL_FIXTURE.id}`,
              item: { itemContent: { tweet_results: { result } } },
            },
          ],
        },
      } as never;
    }
    expect(comparison.tombstoneTextFromAnswer(body, DETAIL_FIXTURE.id)).toBe(
      text,
    );
    expect(comparison.tombstoneTextFromAnswer(body, '901')).toBeNull();
    const projected = extract(body, DETAIL_FIXTURE.id, { instruction: null });
    expect(projected).toEqual({
      kind: 'tombstone',
      reason: text.slice(0, 500),
    });
    expect(text.length).toBeGreaterThan(500);
  },
);

test.each([
  'different-parent',
  'identical-parent',
  'normal-parent-reply',
  'unavailable-parent',
] as const)(
  'ordered answer notice list includes only the prefix through focal: %s',
  (kind) => {
    const fixture = NOTICE_ALIGNMENT_FIXTURE;
    const alignment = comparison.noticeAlignmentFromAnswer(
      noticeAlignmentAnswer(DETAIL_FIXTURE.id, kind),
      DETAIL_FIXTURE.id,
    );
    expect(alignment).toEqual({
      notices: [
        ...(kind === 'normal-parent-reply'
          ? []
          : [
              {
                kind:
                  kind === 'unavailable-parent' ? 'unavailable' : 'tombstone',
                text:
                  kind === 'unavailable-parent'
                    ? null
                    : kind === 'identical-parent'
                      ? fixture.focalText
                      : fixture.parentText,
              },
            ]),
        { kind: 'tombstone', text: fixture.focalText },
      ],
      focalIndex: kind === 'normal-parent-reply' ? 0 : 1,
    });
    const expected =
      kind === 'normal-parent-reply'
        ? [fixture.focalText, fixture.replyText]
        : [
            kind === 'unavailable-parent'
              ? ''
              : kind === 'identical-parent'
                ? fixture.focalText
                : fixture.parentText,
            fixture.focalText,
          ];
    expect(comparison.matchNoticeAlignment(alignment, expected)).toEqual({
      beforeFocal: kind === 'normal-parent-reply' ? 0 : 1,
      candidatesSeen: 2,
      matchedIndex: kind === 'normal-parent-reply' ? 0 : 1,
      matches: true,
    });
  },
);

test.each(['module', 'wrapped', 'replace'] as const)(
  'notice prefix keeps timeline order in %s answer entries',
  (kind) => {
    const answer = noticeAlignmentAnswer(DETAIL_FIXTURE.id);
    const entries =
      answer.data.threaded_conversation_with_injections_v2.instructions[0]!
        .entries;
    if (kind === 'wrapped')
      for (const entry of entries)
        Object.assign(entry.content.itemContent.tweet_results, {
          result: {
            __typename: 'TweetWithVisibilityResults',
            tweet: entry.content.itemContent.tweet_results.result,
          },
        });
    if (kind === 'module') {
      answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries =
        [
          {
            entryId: 'conversationthread-910',
            content: {
              items: entries.map((entry) => ({
                entryId: `conversationthread-910-${entry.entryId}`,
                item: { itemContent: entry.content.itemContent },
              })),
            },
          },
        ] as never;
    }
    if (kind === 'replace') {
      entries.pop();
      answer.data.threaded_conversation_with_injections_v2.instructions.push({
        type: 'TimelineReplaceEntry',
        entry: noticeAlignmentAnswer(DETAIL_FIXTURE.id).data
          .threaded_conversation_with_injections_v2.instructions[0]!.entries[1],
      } as never);
    }
    const alignment = comparison.noticeAlignmentFromAnswer(
      answer,
      DETAIL_FIXTURE.id,
    );
    expect(alignment).toEqual({
      notices: [
        { kind: 'tombstone', text: NOTICE_ALIGNMENT_FIXTURE.parentText },
        { kind: 'tombstone', text: NOTICE_ALIGNMENT_FIXTURE.focalText },
      ],
      focalIndex: 1,
    });
    expect(comparison.tombstoneTextFromAnswer(answer, DETAIL_FIXTURE.id)).toBe(
      NOTICE_ALIGNMENT_FIXTURE.focalText,
    );
    expect(comparison.noticeAlignmentFromAnswer(answer, '999')).toBeNull();
  },
);

test('notice prefix matching cannot substitute another index or ignore earlier text and missing candidates', () => {
  const alignment = comparison.noticeAlignmentFromAnswer(
    noticeAlignmentAnswer(DETAIL_FIXTURE.id),
    DETAIL_FIXTURE.id,
  )!;
  const { parentText, focalText } = NOTICE_ALIGNMENT_FIXTURE;
  for (const candidates of [
    [parentText],
    [parentText, parentText, focalText],
    ['Generated wrong earlier notice', focalText],
    [null, focalText],
    [parentText, null],
    [focalText, parentText],
  ]) {
    expect(comparison.matchNoticeAlignment(alignment, candidates).matches).toBe(
      false,
    );
    expect(
      comparison.matchNoticeAlignment(alignment, candidates).matchedIndex,
    ).toBeNull();
  }
  expect(
    comparison.matchNoticeAlignment(alignment, [
      parentText,
      focalText,
      'Generated ignored reply',
    ]).matches,
  ).toBe(true);
  for (const invalid of [
    null,
    { ...alignment, focalIndex: -1 },
    { ...alignment, focalIndex: 2 },
    {
      ...alignment,
      notices: [
        { kind: 'tombstone' as const, text: '' },
        { kind: 'tombstone' as const, text: focalText },
      ],
    },
  ])
    expect(
      comparison.matchNoticeAlignment(invalid, [parentText, focalText]).matches,
    ).toBe(false);
  const broken = noticeAlignmentAnswer(DETAIL_FIXTURE.id);
  Object.assign(
    broken.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries[0]!.content.itemContent.tweet_results,
    { result: { __typename: 'TweetTombstone', tombstone: { text: {} } } },
  );
  expect(
    comparison.noticeAlignmentFromAnswer(broken, DETAIL_FIXTURE.id),
  ).toBeNull();
});

test('empty focal agreement requires absence of the exact post and error-detail with one visible account switcher', () => {
  const counts = {
    focalArticles: 0,
    errorDetails: 0,
    accountSwitchers: 1,
    accountVisible: true,
  };
  expect(comparison.emptyFocalAgrees(counts)).toBe(true);
  for (const delta of [
    { focalArticles: 1 },
    { focalArticles: 2 },
    { errorDetails: 1 },
    { errorDetails: 2 },
    { accountSwitchers: 0 },
    { accountSwitchers: 2 },
    { accountVisible: false },
  ])
    expect(comparison.emptyFocalAgrees({ ...counts, ...delta })).toBe(false);
});

test('R1 inline quote projection is bound to an absent full-text t.co URL and the exact allowed expanded status path', () => {
  const post = detailPost();
  const permalink = {
    url: 'https://t.co/generatedInline',
    expanded: 'https://TWITTER.com/Generated_Quote/status/901/',
  };
  Object.assign(post.legacy, {
    is_quote_status: true,
    quoted_status_permalink: permalink,
  });
  expect(comparison.inlineQuoteFromAnswer(post)).toEqual({
    path: '/generated_quote/status/901',
  });
  expect(
    comparison.inlineQuoteFromAnswer({
      __typename: 'TweetWithVisibilityResults',
      tweet: post,
    }),
  ).toEqual({ path: '/generated_quote/status/901' });
  for (const host of [
    'x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
  ]) {
    permalink.expanded = `https://${host}/Generated_Quote/status/901/`;
    expect(comparison.inlineQuoteFromAnswer(post)).toEqual({
      path: '/generated_quote/status/901',
    });
  }
  for (const expanded of [
    'https://example.org/Generated_Quote/status/901',
    'https://twitter.com.evil.example/Generated_Quote/status/901',
    'https://user@twitter.com/Generated_Quote/status/901',
    'http://twitter.com/Generated_Quote/status/901',
    'https://twitter.com/Generated_Quote/status/901?generated=1',
    'https://twitter.com/Generated_Quote/status/901#generated',
    'https://twitter.com/Generated_Quote/status/901/photo/1',
    'not a url',
  ]) {
    permalink.expanded = expanded;
    expect(comparison.inlineQuoteFromAnswer(post)).toBeNull();
  }
  permalink.expanded = 'https://twitter.com/Generated_Quote/status/901';
  post.legacy.full_text += ' ' + permalink.url;
  expect(comparison.inlineQuoteFromAnswer(post)).toBeNull();
  const quote = { path: '/generated_quote/status/901' };
  expect(
    comparison.inlineQuoteMatches('/Generated_Quote/status/901/', quote),
  ).toBe(true);
  for (const href of [
    '/Generated_Quote/status/902',
    '/Other/status/901',
    'https://twitter.com/Generated_Quote/status/901',
    '//twitter.com/Generated_Quote/status/901',
    '/Generated_Quote/status/901?x=1',
  ])
    expect(comparison.inlineQuoteMatches(href, quote)).toBe(false);
  expect(
    comparison.removeInlineQuoteSuffix('Generated text link link', 'link'),
  ).toBe('Generated text link ');
  expect(
    comparison.removeInlineQuoteSuffix('Generated text link tail', 'link'),
  ).toBe('Generated text link tail');
});
