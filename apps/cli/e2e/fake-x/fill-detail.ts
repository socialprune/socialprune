import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../src/originals/test/detail.ts';

/** Generated conversation module with the observed show-more cursor shape. */
export function moduleCursorAnswer(
  focalId = DETAIL_FIXTURE.id,
  unknownItem = false,
) {
  const root = detailPost('901');
  const parent = {
    ...detailPost('902'),
    legacy: { ...detailPost('902').legacy, in_reply_to_status_id_str: '901' },
  };
  const focal = {
    ...detailPost(focalId),
    legacy: { ...detailPost(focalId).legacy, in_reply_to_status_id_str: '902' },
    note_tweet: {
      note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
    },
  };
  const original = detailAnswer(focal);
  const cursor = unknownItem
    ? {
        __typename: 'GeneratedUnknownModule',
        itemType: 'GeneratedUnknown',
        value: 'Generated secret @private_decoy 12345678901234567890',
      }
    : {
        cursorType: 'ShowMore',
        value: 'generated-cursor-value',
        displayTreatment: { actionText: 'Generated show more' },
      };
  const entries: unknown[] = [
    {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'tweet-901',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: 'cursor-show-more-generated',
            item: { itemContent: cursor },
          },
          {
            entryId: 'tweet-902',
            item: { itemContent: { tweet_results: { result: parent } } },
          },
        ],
      },
    },
    ...original.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries,
  ];
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineAddEntries', entries }],
      },
    },
  };
}

export const DISPLAY_COMPARISON_FIXTURE = {
  mention: '@generated_reply ',
  encodedDisplay:
    'Generated &amp; decoded visit https://t.co/generatedLink with a final tail 😀',
  decodedDisplay:
    'Generated & decoded visit https://t.co/generatedLink with a final tail 😀',
  shownInnerText:
    'Generated & decoded visit example.org/generated with a final tail ',
  renderedLink: 'example.org/generated',
  mediaUrl: 'https://t.co/generatedMedia',
  emoji: '😀',
  pngBase64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK5sAAAAASUVORK5CYII=',
};

export function displayComparisonAnswer(
  focalId = DETAIL_FIXTURE.id,
  defect: 'none' | 'alt' | 'tail' = 'none',
) {
  const encodedDisplay =
    defect === 'alt'
      ? DISPLAY_COMPARISON_FIXTURE.encodedDisplay.replace('😀', '')
      : defect === 'tail'
        ? DISPLAY_COMPARISON_FIXTURE.encodedDisplay.replace(
            ' with a final tail',
            '',
          )
        : DISPLAY_COMPARISON_FIXTURE.encodedDisplay;
  const fullText =
    DISPLAY_COMPARISON_FIXTURE.mention +
    encodedDisplay +
    ' ' +
    DISPLAY_COMPARISON_FIXTURE.mediaUrl;
  const displayRange = [
    Array.from(DISPLAY_COMPARISON_FIXTURE.mention).length,
    Array.from(DISPLAY_COMPARISON_FIXTURE.mention + encodedDisplay).length,
  ];
  return detailAnswer({
    ...detailPost(focalId),
    legacy: {
      ...detailPost(focalId).legacy,
      full_text: fullText,
      display_text_range: displayRange,
      entities: {
        urls: [
          {
            url: 'https://t.co/generatedLink',
            display_url: DISPLAY_COMPARISON_FIXTURE.renderedLink,
          },
        ],
        media: [{ url: DISPLAY_COMPARISON_FIXTURE.mediaUrl }],
      },
      extended_entities: {
        media: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/generated-photo.png',
            url: DISPLAY_COMPARISON_FIXTURE.mediaUrl,
          },
        ],
      },
    },
  });
}

export function displayComparisonMarkup(focalId: string): string {
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><p data-testid="tweetText">Generated &amp; decoded visit <a href="https://t.co/generatedLink">${DISPLAY_COMPARISON_FIXTURE.renderedLink}</a> with a final tail <img src="/generated-emoji.png" alt="${DISPLAY_COMPARISON_FIXTURE.emoji}"></p><a role="link" href="/generated/status/${focalId}/photo/1"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated photo"></div></a></article>`;
}

export const CARD_COMPARISON_FIXTURE = {
  ownText: 'Generated focal quotation.',
  linkText: 'Generated link-card caption',
  renderedLink: 'example.org/generated-card',
  cardUrl: 'https://t.co/generatedCard',
  quoteUrl: 'https://t.co/generatedQuote',
  quotedText: 'Generated quoted card text that is not focal text.',
};

export type CardComparisonKind =
  'quote' | 'link' | 'video' | 'rendered-link' | 'missing-rendered-link';
export function cardComparisonAnswer(
  focalId: string,
  kind: CardComparisonKind,
) {
  const { ownText, linkText, cardUrl, quoteUrl } = CARD_COMPARISON_FIXTURE;
  const caption = kind === 'quote' ? ownText : kind === 'video' ? '' : linkText;
  const includesLink = kind !== 'missing-rendered-link';
  const link = kind === 'quote' || kind === 'video' ? quoteUrl : cardUrl;
  const fullText =
    caption + (caption && includesLink ? ' ' : '') + (includesLink ? link : '');
  const ownDisplay = kind === 'quote' || kind === 'video' ? caption : fullText;
  const media =
    kind === 'video'
      ? [
          {
            type: 'video',
            media_url_https: 'https://pbs.twimg.com/generated-photo.png',
            video_info: { variants: [] },
          },
        ]
      : [];
  const quoted = {
    ...detailPost('909'),
    legacy: {
      ...detailPost('909').legacy,
      full_text: CARD_COMPARISON_FIXTURE.quotedText,
      extended_entities: {
        media: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/generated-photo.png',
          },
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/generated-photo.png',
          },
        ],
      },
    },
  };
  return detailAnswer({
    ...detailPost(focalId),
    ...(kind === 'quote' || kind === 'video'
      ? { quoted_status_result: { result: quoted } }
      : {
          card: {
            rest_id: 'generated-card-record',
            legacy: {
              url: cardUrl,
              name: 'summary',
              binding_values: [
                { key: 'card_url', value: { string_value: cardUrl } },
              ],
              card_platform: {
                platform: {
                  device: { name: 'Web' },
                  audience: { name: 'Generated' },
                },
              },
              user_refs_results: [],
            },
          },
        }),
    legacy: {
      ...detailPost(focalId).legacy,
      full_text: fullText,
      display_text_range: [0, Array.from(ownDisplay).length],
      ...(kind === 'quote' || kind === 'video'
        ? {
            quoted_status_id_str: '909',
            quoted_status_permalink: {
              url: quoteUrl,
              expanded: 'https://example.org/generated-quote',
              display: 'example.org/generated-quote',
            },
          }
        : {}),
      entities: {
        urls:
          kind === 'quote' || kind === 'video'
            ? null
            : [
                {
                  url: cardUrl,
                  display_url: CARD_COMPARISON_FIXTURE.renderedLink,
                },
              ],
      },
      extended_entities: { media },
    },
  });
}

export function cardComparisonMarkup(
  focalId: string,
  kind: CardComparisonKind,
): string {
  const quotedCard = `<div role="link"><p data-testid="tweetText">${CARD_COMPARISON_FIXTURE.quotedText}<img src="/generated-emoji.png" alt="😀"></p><a role="link" href="/generated/status/909/photo/1"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated quoted photo"></div></a><a role="link" href="/generated/status/909/photo/2"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated quoted second photo"></div></a></div>`;
  const own =
    kind === 'quote'
      ? `<p data-testid="tweetText">${CARD_COMPARISON_FIXTURE.ownText}</p>`
      : kind === 'video'
        ? '<div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video preload="none"></video></div></div>'
        : `<p data-testid="tweetText">${CARD_COMPARISON_FIXTURE.linkText}${kind === 'rendered-link' || kind === 'missing-rendered-link' ? ` <a href="${CARD_COMPARISON_FIXTURE.cardUrl}">${CARD_COMPARISON_FIXTURE.renderedLink}</a>` : ''}</p>`;
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a>${own}${kind === 'quote' || kind === 'video' ? quotedCard : '<div role="link" data-testid="card.wrapper">Generated link card</div>'}</article>`;
}

export const OWN_PHOTO_FIXTURE = {
  text: 'Generated focal post with two own photos.',
  photos: 2,
  mediaUrl: 'https://t.co/generatedPhotos',
};

export function ownPhotoAnswer(focalId: string) {
  return detailAnswer({
    ...detailPost(focalId),
    legacy: {
      ...detailPost(focalId).legacy,
      full_text: OWN_PHOTO_FIXTURE.text + ' ' + OWN_PHOTO_FIXTURE.mediaUrl,
      display_text_range: [0, Array.from(OWN_PHOTO_FIXTURE.text).length],
      entities: { media: [{ url: OWN_PHOTO_FIXTURE.mediaUrl }] },
      extended_entities: {
        media: Array.from({ length: OWN_PHOTO_FIXTURE.photos }, () => ({
          type: 'photo',
          media_url_https: 'https://pbs.twimg.com/generated-photo.png',
          url: OWN_PHOTO_FIXTURE.mediaUrl,
        })),
      },
    },
  });
}

export function ownPhotoMarkup(focalId: string): string {
  const photos = Array.from(
    { length: OWN_PHOTO_FIXTURE.photos },
    (_, index) =>
      `<a role="link" href="/generated/status/${focalId}/photo/${index + 1}"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated own photo ${index + 1}"></div></a>`,
  ).join('');
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><p data-testid="tweetText">${OWN_PHOTO_FIXTURE.text}</p>${photos}</article>`;
}
