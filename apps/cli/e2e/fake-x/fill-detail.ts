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
      entryId: 'conversationthread-901',
      content: {
        items: [
          {
            entryId: 'conversationthread-901-tweet-901',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: unknownItem
              ? 'conversationthread-901-tweet-905'
              : 'cursor-show-more-generated',
            item: { itemContent: cursor },
          },
          {
            entryId: 'conversationthread-901-tweet-902',
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

export const GATED_MEDIA_FIXTURE = {
  text: 'Generated gated text',
  mediaLink: 'https://t.co/generatedGated',
  posterUrl: 'https://pbs.twimg.com/generated-gated-poster.png',
  videoUrl: 'https://video.twimg.com/generated-gated.mp4',
  photoUrl: 'https://pbs.twimg.com/generated-gated-photo.png',
  overlay: 'Anzeigen',
  parentId: '901',
  quotedId: '909',
  mp4Base64: 'AAAADGZ0eXBpc29t',
};

/** Entirely generated answer with the observed visibility wrapper shape. */
export function gatedMediaPost(id: string, kind: 'video' | 'photo' = 'video') {
  const tweet = {
    ...detailPost(id),
    legacy: {
      ...detailPost(id).legacy,
      full_text: GATED_MEDIA_FIXTURE.text + ' ' + GATED_MEDIA_FIXTURE.mediaLink,
      display_text_range: [0, Array.from(GATED_MEDIA_FIXTURE.text).length],
      possibly_sensitive: true,
      entities: { media: [{ url: GATED_MEDIA_FIXTURE.mediaLink }] },
      extended_entities: {
        media: [
          {
            type: kind,
            media_url_https:
              kind === 'photo'
                ? GATED_MEDIA_FIXTURE.photoUrl
                : GATED_MEDIA_FIXTURE.posterUrl,
            ...(kind === 'video'
              ? {
                  video_info: {
                    duration_millis: 1200,
                    variants: [
                      {
                        content_type: 'video/mp4',
                        bitrate: 832000,
                        url: GATED_MEDIA_FIXTURE.videoUrl,
                      },
                    ],
                  },
                }
              : {}),
          },
        ],
      },
    },
  };
  delete (tweet as Partial<typeof tweet>).__typename;
  return {
    __typename: 'TweetWithVisibilityResults',
    tweet,
    mediaVisibilityResults: {
      blurred_image_interstitial: {
        interstitial_action: 'AgeVerificationPrompt',
        opacity: 0.5,
        title: { text: 'Generated overlay title', entities: [], rtl: false },
        text: {
          text: 'Generated overlay explanation',
          entities: [],
          rtl: false,
        },
      },
    },
  };
}

export function gatedMediaAnswer(focalId: string, family = false) {
  const focal = gatedMediaPost(focalId);
  const body = detailAnswer(focal);
  if (family) {
    Object.assign(focal.tweet.legacy, {
      in_reply_to_status_id_str: GATED_MEDIA_FIXTURE.parentId,
      quoted_status_id_str: GATED_MEDIA_FIXTURE.quotedId,
    });
    Object.assign(focal.tweet, {
      quoted_status_result: {
        result: gatedMediaPost(GATED_MEDIA_FIXTURE.quotedId),
      },
    });
    body.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
      {
        entryId: `conversationthread-${GATED_MEDIA_FIXTURE.parentId}`,
        content: {
          items: [
            {
              entryId: `conversationthread-${GATED_MEDIA_FIXTURE.parentId}-tweet-${GATED_MEDIA_FIXTURE.parentId}`,
              item: {
                itemContent: {
                  tweet_results: {
                    result: gatedMediaPost(
                      GATED_MEDIA_FIXTURE.parentId,
                      'photo',
                    ),
                  },
                },
              },
            },
          ],
        },
      } as never,
    );
  }
  return body;
}

export function gatedMediaMarkup(focalId: string, exposed = false): string {
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><p data-testid="tweetText">${GATED_MEDIA_FIXTURE.text}</p><div><div role="button" onclick="fetch('/generated-reveal',{method:'POST'})">${GATED_MEDIA_FIXTURE.overlay}</div></div>${exposed ? '<div data-testid="videoPlayer"><video preload="none"></video></div>' : ''}</article>`;
}

export const NOTE_RENDER_FIXTURE = {
  text: 'Generated note text with a photo below this paragraph. '
    .repeat(9)
    .trim(),
  delayMs: 1500,
  photoUrl: 'https://pbs.twimg.com/generated-photo.png',
};

export function notePhotoAnswer(focalId: string) {
  return detailAnswer({
    ...detailPost(focalId),
    note_tweet: {
      note_tweet_results: { result: { text: NOTE_RENDER_FIXTURE.text } },
    },
    legacy: {
      ...detailPost(focalId).legacy,
      extended_entities: {
        media: [
          { type: 'photo', media_url_https: NOTE_RENDER_FIXTURE.photoUrl },
        ],
      },
    },
  });
}

export function notePhotoMarkup(
  focalId: string,
  kind: 'delayed-photo' | 'missing-photo' | 'delayed-text',
): string {
  const text = `<p data-testid="tweetText">${NOTE_RENDER_FIXTURE.text}</p>`;
  const photo = `<a role="link" href="/generated/status/${focalId}/photo/1"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated note photo"></div></a>`;
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><div id="generated-note-text">${kind === 'delayed-text' ? '' : text}</div><div id="generated-note-media">${kind === 'delayed-text' ? photo : ''}</div></article>${kind === 'missing-photo' ? '' : `<script>setTimeout(()=>document.getElementById('${kind === 'delayed-text' ? 'generated-note-text' : 'generated-note-media'}').innerHTML=${JSON.stringify(kind === 'delayed-text' ? text : photo)},${NOTE_RENDER_FIXTURE.delayMs})</script>`}`;
}

export function gatedLatePlayerMarkup(focalId: string): string {
  return (
    gatedMediaMarkup(focalId) +
    `<script>setTimeout(()=>document.querySelector('article[data-testid="tweet"]').insertAdjacentHTML('beforeend','<div data-testid="videoPlayer"><video preload="none"></video></div>'),${NOTE_RENDER_FIXTURE.delayMs})</script>`
  );
}

export const PROTECTED_NOTICE_FIXTURE = {
  de: [
    'Generierter Hinweis.',
    'Dieses Konto begrenzt,',
    'wer diesen Beitrag sehen kann.',
    'Der Beitrag ist geschützt.',
  ],
  en: [
    'Generated notice.',
    'This account limits',
    'who can view this post.',
    'The post is protected.',
  ],
  link: { de: 'Mehr erfahren', en: 'Learn more' },
  longPrefix: 'Generated protected context. '.repeat(24),
  tail: 'Generated final notice detail.',
  wrongTail: 'Generated changed notice detail.',
};

export function protectedNoticeText(lang: 'de' | 'en', long = false): string {
  return (
    (long ? PROTECTED_NOTICE_FIXTURE.longPrefix : '') +
    PROTECTED_NOTICE_FIXTURE[lang].join(' ') +
    ' ' +
    PROTECTED_NOTICE_FIXTURE.link[lang] +
    (long ? ' ' + PROTECTED_NOTICE_FIXTURE.tail : '')
  );
}

export function protectedNoticeAnswer(
  focalId: string,
  lang: 'de' | 'en',
  long = false,
) {
  return detailAnswer(
    {
      __typename: 'TweetTombstone',
      tombstone: {
        __typename: 'TextTombstone',
        text: { text: protectedNoticeText(lang, long), entities: [] },
      },
    },
    [detailPost('901')],
  );
}

export function protectedNoticeMarkup(
  lang: 'de' | 'en',
  kind:
    | 'match'
    | 'different'
    | 'duplicate'
    | 'missing'
    | 'long-tail'
    | 'long-match'
    | 'missing-link'
    | 'delayed'
    | 'error-detail' = 'match',
): string {
  const spans = PROTECTED_NOTICE_FIXTURE[lang]
    .map((text) => `<span>${text}</span>`)
    .join(' ');
  const link = `<a href="/generated-learn-more">${PROTECTED_NOTICE_FIXTURE.link[lang]}</a>`;
  const content =
    (kind === 'long-tail' || kind === 'long-match'
      ? PROTECTED_NOTICE_FIXTURE.longPrefix
      : '') +
    spans +
    ' ' +
    (kind === 'missing-link' ? '' : link) +
    (kind === 'long-tail'
      ? ' ' + PROTECTED_NOTICE_FIXTURE.wrongTail
      : kind === 'long-match'
        ? ' ' + PROTECTED_NOTICE_FIXTURE.tail
        : '');
  const notice =
    kind === 'error-detail'
      ? `<div data-testid="error-detail">${content}</div>`
      : `<div data-testid="cellInnerDiv"><div role="article">${kind === 'different' ? 'Generated different notice.' : content}</div></div>`;
  const parent = `<article data-testid="tweet"><a href="/generated/status/901"><time>2026</time></a><p data-testid="tweetText">Generated parent post above the notice</p></article>`;
  return `<main lang="${lang}">${parent}<div id="generated-notice">${kind === 'missing' || kind === 'delayed' ? '' : notice}${kind === 'duplicate' ? notice : ''}</div></main>${kind === 'delayed' ? `<script>setTimeout(()=>document.getElementById('generated-notice').innerHTML=${JSON.stringify(notice)},1500)</script>` : ''}`;
}

export const NOTICE_ALIGNMENT_FIXTURE = {
  parentId: '901',
  replyId: '911',
  parentText:
    'Generierter Elternhinweis. Dieser Beitrag wurde entfernt. Mehr erfahren',
  focalText: protectedNoticeText('de'),
  replyText: 'Generierter Antworthinweis. Dieser Beitrag ist nicht verfügbar.',
};
export type NoticeAlignmentKind =
  | 'different-parent'
  | 'identical-parent'
  | 'normal-parent-reply'
  | 'wrong-focal'
  | 'wrong-parent'
  | 'missing-candidate'
  | 'unavailable-parent'
  | 'delayed';

export function noticeAlignmentAnswer(
  focalId: string,
  kind: NoticeAlignmentKind = 'different-parent',
) {
  const fixture = NOTICE_ALIGNMENT_FIXTURE;
  const notice = (text: string) => ({
    __typename: 'TweetTombstone',
    tombstone: { __typename: 'TextTombstone', text: { text, entities: [] } },
  });
  const entry = (id: string, result: unknown) => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result } } },
  });
  const parent =
    kind === 'normal-parent-reply'
      ? detailPost(fixture.parentId)
      : kind === 'unavailable-parent'
        ? { __typename: 'TweetUnavailable' }
        : notice(
            kind === 'identical-parent'
              ? fixture.focalText
              : fixture.parentText,
          );
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              entry(fixture.parentId, parent),
              entry(focalId, notice(fixture.focalText)),
              ...(kind === 'normal-parent-reply'
                ? [entry(fixture.replyId, { __typename: 'TweetUnavailable' })]
                : []),
            ],
          },
        ],
      },
    },
  };
}

export function noticeAlignmentMarkup(
  kind: NoticeAlignmentKind = 'different-parent',
): string {
  const fixture = NOTICE_ALIGNMENT_FIXTURE;
  const notice = (text: string) =>
    `<div data-testid="cellInnerDiv"><div role="article"><span>${text.replace(' Mehr erfahren', '')}</span>${text.endsWith(' Mehr erfahren') ? ' <a href="/generated-learn-more">Mehr erfahren</a>' : ''}</div></div>`;
  const parent =
    kind === 'normal-parent-reply'
      ? `<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/generated/status/${fixture.parentId}"><time>2026</time></a><p data-testid="tweetText">Generated normal parent</p></article></div>`
      : notice(
          kind === 'identical-parent'
            ? fixture.focalText
            : kind === 'wrong-parent'
              ? 'Generierter falscher Elternhinweis.'
              : kind === 'unavailable-parent'
                ? 'Generierter nicht lesbarer Hinweis.'
                : fixture.parentText,
        );
  const focal = notice(
    kind === 'wrong-focal'
      ? 'Generierter falscher Fokalhinweis.'
      : fixture.focalText,
  );
  return `<main lang="de">${parent}<div id="generated-focal-notice">${kind === 'missing-candidate' || kind === 'delayed' ? '' : focal}</div>${kind === 'normal-parent-reply' ? notice(fixture.replyText) : ''}<div data-testid="cellInnerDiv">Generated non-notice cell</div></main>${kind === 'delayed' ? `<script>setTimeout(()=>document.getElementById('generated-focal-notice').innerHTML=${JSON.stringify(focal)},1500)</script>` : ''}`;
}

export const EMPTY_RESULTS_FIXTURE = {
  rootId: '901',
  parentId: '902',
  replyId: '903',
  emptyId: '905',
  modules: 2,
  skipped: 1,
};

export function emptyResultsAnswer(
  focalId: string,
  kind: 'module' | 'entry' | 'parent' | 'focal' | 'unknown' = 'module',
) {
  const { rootId, parentId, replyId, emptyId } = EMPTY_RESULTS_FIXTURE;
  const content = (result?: unknown) => ({
    __typename: 'TimelineTweet',
    itemType: 'TimelineTweet',
    tweetDisplayType: 'Tweet',
    tweet_results: result === undefined ? {} : { result },
  });
  const item = (id: string, result?: unknown, threadId = rootId) => ({
    entryId: `conversationthread-${threadId}-tweet-${id}`,
    item: { itemContent: content(result) },
  });
  const root = detailPost(rootId);
  const parent = detailPost(parentId);
  Object.assign(parent.legacy, {
    in_reply_to_status_id_str: kind === 'parent' ? emptyId : rootId,
  });
  const focal = detailPost(focalId);
  Object.assign(focal.legacy, { in_reply_to_status_id_str: parentId });
  Object.assign(focal, {
    note_tweet: {
      note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
    },
  });
  const empty = item(
    emptyId,
    kind === 'unknown' ? { __typename: 'GeneratedUnknownResult' } : undefined,
  );
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              {
                entryId: `conversationthread-${rootId}`,
                content: {
                  entryType: 'TimelineTimelineModule',
                  displayType: 'VerticalConversation',
                  items: [
                    item(rootId, root),
                    ...(kind === 'entry' ? [] : [empty]),
                    item(parentId, parent),
                  ],
                },
              },
              {
                entryId: `conversationthread-${replyId}`,
                content: {
                  entryType: 'TimelineTimelineModule',
                  displayType: 'VerticalConversation',
                  items: [item(replyId, detailPost(replyId), replyId)],
                },
              },
              ...(kind === 'entry'
                ? [
                    {
                      entryId: `tweet-${emptyId}`,
                      content: {
                        entryType: 'TimelineTimelineItem',
                        itemContent: content(),
                      },
                    },
                  ]
                : []),
              {
                entryId: `tweet-${focalId}`,
                content: {
                  entryType: 'TimelineTimelineItem',
                  itemContent: content(kind === 'focal' ? undefined : focal),
                },
              },
              {
                entryId: 'cursor-bottom-generated',
                content: {
                  entryType: 'TimelineTimelineCursor',
                  cursorType: 'Bottom',
                },
              },
            ],
          },
        ],
      },
    },
  };
}

export const MODULE_ITEM_IDS_FIXTURE = {
  normalItems: 35,
  emptyItems: 1,
  emptyId: '11000',
  firstThreadId: 20001,
  firstPostId: 10001,
};

/** Generated 35 reply modules and one contentless reply with numeric item IDs. */
export function moduleItemIdsAnswer(focalId = DETAIL_FIXTURE.id) {
  const fixture = MODULE_ITEM_IDS_FIXTURE;
  const modules = Array.from({ length: fixture.normalItems }, (_, index) => {
    const threadId = String(fixture.firstThreadId + index);
    const postId = String(fixture.firstPostId + index);
    const item = (id: string, result?: unknown) => ({
      entryId: `conversationthread-${threadId}-tweet-${id}`,
      item: {
        itemContent: {
          __typename: 'TimelineTweet',
          itemType: 'TimelineTweet',
          tweetDisplayType: 'Tweet',
          tweet_results: result === undefined ? {} : { result },
        },
      },
    });
    return {
      entryId: `conversationthread-${threadId}`,
      content: {
        entryType: 'TimelineTimelineModule',
        displayType: 'VerticalConversation',
        items: [
          item(postId, detailPost(postId)),
          ...(index === 17 ? [item(fixture.emptyId)] : []),
        ],
      },
    };
  });
  const focal = detailPost(focalId);
  Object.assign(focal, {
    note_tweet: {
      note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
    },
  });
  const body = detailAnswer(focal);
  const focalEntry =
    body.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries[0]!;
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              ...modules,
              focalEntry,
              {
                entryId: 'cursor-bottom-generated',
                content: {
                  entryType: 'TimelineTimelineCursor',
                  cursorType: 'Bottom',
                },
              },
            ],
          },
        ],
      },
    },
  };
}

export const TEXT_CONTENT_FIXTURE = {
  prefix:
    'Generated note text before the mention. '.repeat(12) +
    'Generated required word',
  mention: '@generated_mention',
  suffix: 'final note tail.',
  linkUrl: 'https://t.co/generatedLayoutLink',
  linkHiddenPrefix: 'https://',
  linkVisibleText: 'example.org/generated',
};

export type TextContentKind =
  'mention' | 'missing-word' | 'hidden-link' | 'missing-link';
export function textContentStoredText(kind: TextContentKind): string {
  const { prefix, mention, suffix, linkUrl } = TEXT_CONTENT_FIXTURE;
  if (kind === 'hidden-link' || kind === 'missing-link')
    return prefix + mention + (kind === 'hidden-link' ? linkUrl : '') + suffix;
  return (
    (kind === 'missing-word' ? prefix.replace('required ', '') : prefix) +
    mention +
    suffix
  );
}

export function textContentAnswer(focalId: string, kind: TextContentKind) {
  return detailAnswer({
    ...detailPost(focalId),
    note_tweet: {
      note_tweet_results: { result: { text: textContentStoredText(kind) } },
    },
    legacy: {
      ...detailPost(focalId).legacy,
      extended_entities: {
        media: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/generated-photo.png',
          },
        ],
      },
    },
  });
}

export function textContentMarkup(
  focalId: string,
  kind: TextContentKind,
): string {
  const fixture = TEXT_CONTENT_FIXTURE;
  const mention = `<div style="display:inline-flex"><span><a href="/generated_mention">${fixture.mention}</a></span></div>`;
  const link =
    kind === 'hidden-link' || kind === 'missing-link'
      ? `<a href="${fixture.linkUrl}"><span style="display:none">${fixture.linkHiddenPrefix}</span>${fixture.linkVisibleText}</a>`
      : '';
  return `<article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><div data-testid="tweetText">${fixture.prefix}${mention}${link}${fixture.suffix}</div><a role="link" href="/generated/status/${focalId}/photo/1"><div data-testid="tweetPhoto"><img src="/generated-photo.png" alt="Generated note photo"></div></a></article>`;
}

export const NOTICE_PARENT_FIXTURE = {
  parentId: '901',
  nearerId: '902',
  text: 'Generierter Hinweis. Dieses Konto begrenzt, wer diesen Beitrag sehen kann. Mehr erfahren',
  focalText: 'Generated reply below a parent notice.',
  linkText: 'Mehr erfahren',
  linkUrl: 'https://help.x.com/generated-notice',
};
export type NoticeParentKind =
  'direct' | 'module' | 'unknown-direct' | 'unknown-module';

export function noticeParentAnswer(
  focalId: string,
  kind: NoticeParentKind = 'direct',
  unavailable = false,
  wrapped = false,
  nearer = false,
) {
  const fixture = NOTICE_PARENT_FIXTURE;
  const result = kind.startsWith('unknown-')
    ? { __typename: 'GeneratedUnknownParent' }
    : unavailable
      ? {
          __typename: 'TweetUnavailable',
          reason: 'Generated unavailable parent',
        }
      : {
          __typename: 'TweetTombstone',
          tombstone: {
            __typename: 'TextTombstone',
            text: {
              text: fixture.text,
              rtl: false,
              entities: [
                {
                  fromIndex: fixture.text.indexOf(fixture.linkText),
                  toIndex: fixture.text.length,
                  ref: {
                    type: 'TimelineUrl',
                    url: fixture.linkUrl,
                    urlType: 'ExternalUrl',
                  },
                },
              ],
            },
          },
        };
  const parent = wrapped
    ? { __typename: 'TweetWithVisibilityResults', tweet: result }
    : result;
  const focal = detailPost(focalId);
  Object.assign(focal.legacy, {
    in_reply_to_status_id_str: nearer ? fixture.nearerId : fixture.parentId,
  });
  Object.assign(focal, {
    note_tweet: { note_tweet_results: { result: { text: fixture.focalText } } },
  });
  const entry = (id: string, value: unknown) => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result: value } } },
  });
  const readableParent = detailPost(fixture.nearerId);
  Object.assign(readableParent.legacy, {
    in_reply_to_status_id_str: fixture.parentId,
  });
  const parents = [
    entry(fixture.parentId, parent),
    ...(nearer ? [entry(fixture.nearerId, readableParent)] : []),
  ];
  const entries = kind.endsWith('module')
    ? [
        {
          entryId: `conversationthread-${fixture.parentId}`,
          content: {
            entryType: 'TimelineTimelineModule',
            displayType: 'VerticalConversation',
            items: parents.map((value) => ({
              entryId: `conversationthread-${fixture.parentId}-${value.entryId}`,
              item: { itemContent: value.content.itemContent },
            })),
          },
        },
      ]
    : parents;
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [...entries, entry(focalId, focal)],
          },
        ],
      },
    },
  };
}

export function noticeParentMarkup(focalId: string): string {
  const fixture = NOTICE_PARENT_FIXTURE;
  return `<div data-testid="cellInnerDiv"><div role="article"><span>${fixture.text.slice(0, -fixture.linkText.length)}</span><a href="/generated-learn-more">${fixture.linkText}</a></div></div><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/generated/status/${focalId}"><time>2026</time></a><p data-testid="tweetText">${fixture.focalText}</p></article></div>`;
}

export const EMPTY_FOCAL_FIXTURE = {
  parentId: '901',
  replyId: '912',
  nextId: '909',
  delayMs: 1500,
  oldText: 'Generated earlier anonymous text',
};
export type EmptyFocalKind =
  'empty' | 'present' | 'late' | 'transient' | 'error' | 'module' | 'unknown';

export function emptyFocalAnswer(
  focalId: string,
  kind: EmptyFocalKind = 'empty',
) {
  const entry = (id: string, result?: unknown) => ({
    entryId: `tweet-${id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        __typename: 'TimelineTweet',
        itemType: 'TimelineTweet',
        tweetDisplayType: 'Tweet',
        tweet_results: result === undefined ? {} : { result },
      },
    },
  });
  const focal = entry(
    focalId,
    kind === 'unknown' ? { __typename: 'GeneratedUnknownFocal' } : undefined,
  );
  const entries = [
    entry(
      EMPTY_FOCAL_FIXTURE.parentId,
      detailPost(EMPTY_FOCAL_FIXTURE.parentId),
    ),
    ...(kind === 'module'
      ? [
          {
            entryId: `conversationthread-${focalId}`,
            content: {
              entryType: 'TimelineTimelineModule',
              displayType: 'VerticalConversation',
              items: [
                {
                  entryId: `conversationthread-${focalId}-tweet-${focalId}`,
                  item: { itemContent: focal.content.itemContent },
                },
              ],
            },
          },
        ]
      : [focal]),
    entry(EMPTY_FOCAL_FIXTURE.replyId, detailPost(EMPTY_FOCAL_FIXTURE.replyId)),
  ];
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineAddEntries', entries }],
      },
    },
  };
}

export function emptyFocalMarkup(
  focalId: string,
  kind: EmptyFocalKind = 'empty',
): string {
  const post = (id: string) =>
    `<article data-testid="tweet"><a href="/generated/status/${id}"><time>2026</time></a><p data-testid="tweetText">Generated neighbour post</p></article>`;
  const focal = post(focalId);
  const script =
    kind === 'late' || kind === 'transient'
      ? `<script>setTimeout(()=>{document.getElementById('generated-focal').innerHTML=${JSON.stringify(focal)};${kind === 'transient' ? "setTimeout(()=>document.getElementById('generated-focal').innerHTML='',300);" : ''}},${EMPTY_FOCAL_FIXTURE.delayMs})</script>`
      : '';
  return `${post(EMPTY_FOCAL_FIXTURE.parentId)}<div id="generated-focal">${kind === 'present' ? focal : ''}</div>${post(EMPTY_FOCAL_FIXTURE.replyId)}${kind === 'error' ? '<p data-testid="error-detail">Generated error notice</p>' : ''}${script}`;
}

export const STOP_DETAIL_FIXTURE = {
  switcherDelayMs: 1500,
  renderWaitMs: 1000,
  timeoutEn: 'X did not load the page in time. Nothing was changed.',
  timeoutDe:
    'X hat die Seite nicht rechtzeitig geladen. Es wurde nichts geändert.',
  markerEn: 'X shows a sign-in, account check, lock or limit page.',
  markerDe:
    'X zeigt eine Seite zum Anmelden, eine Kontoprüfung, eine Sperre oder ein Limit.',
};
export function delayedStopSwitcherMarkup(account: string): string {
  return `<div id="generated-switcher"></div><script>setTimeout(()=>document.getElementById('generated-switcher').innerHTML=${JSON.stringify(account)},${STOP_DETAIL_FIXTURE.switcherDelayMs})</script>`;
}

export const INLINE_QUOTE_FIXTURE = {
  text: 'Generated own text quoting a post that is unavailable.',
  quotedId: '901',
  url: 'https://t.co/generatedInlineQuote',
  expanded: 'https://twitter.com/generated_quote/status/901',
  href: '/generated_quote/status/901',
  visible: 'twitter.com/generated_quote/status/901…',
};
export type InlineQuoteKind =
  'match' | 'different-path' | 'in-full-text' | 'not-trailing';
export function inlineQuoteAnswer(id: string, kind: InlineQuoteKind = 'match') {
  const post = detailPost(id);
  const fullText =
    INLINE_QUOTE_FIXTURE.text +
    (kind === 'in-full-text' ? ' ' + INLINE_QUOTE_FIXTURE.url : '');
  Object.assign(post.legacy, {
    full_text: fullText,
    display_text_range: [0, Array.from(fullText).length],
    is_quote_status: true,
    quoted_status_id_str: INLINE_QUOTE_FIXTURE.quotedId,
    quoted_status_permalink: {
      url: INLINE_QUOTE_FIXTURE.url,
      expanded: INLINE_QUOTE_FIXTURE.expanded,
    },
    entities: { urls: [], media: [] },
    extended_entities: { media: [] },
  });
  Object.assign(post, {
    quoted_status_result: {
      result: {
        __typename: 'TweetTombstone',
        tombstone: {
          __typename: 'TextTombstone',
          text: { text: 'Generated unavailable quote notice' },
        },
      },
    },
  });
  return detailAnswer(post);
}
export function inlineQuoteMarkup(
  id: string,
  kind: InlineQuoteKind = 'match',
): string {
  const href =
    kind === 'different-path'
      ? '/generated_quote/status/902'
      : INLINE_QUOTE_FIXTURE.href;
  const anchor = `<a href="${href}"><div style="display:inline-flex"><span>https://</span></div><span>${INLINE_QUOTE_FIXTURE.visible}</span></a>`;
  const own = INLINE_QUOTE_FIXTURE.text;
  return `<article data-testid="tweet"><a href="/generated/status/${id}"><time>2026</time></a><div data-testid="tweetText">${kind === 'not-trailing' ? own.slice(0, -1) + ' ' + anchor + '.' : own + ' ' + anchor}</div></article>`;
}

export const STATUS_ENTITY_FIXTURE = {
  prefix: 'Generated linked status: ',
  url: 'https://t.co/generatedStatus',
  expanded: 'https://x.com/generated_status/status/901',
  path: '/generated_status/status/901',
  label: 'x.com/generated_status/status/901…',
};
export type StatusEntityKind =
  | 'match'
  | 'different-path'
  | 'outside-range'
  | 'non-status'
  | 'duplicate'
  | 'video-path'
  | 'tco-anchor';
export function statusEntityAnswer(
  id: string,
  kind: StatusEntityKind = 'match',
) {
  const fixture = STATUS_ENTITY_FIXTURE;
  const post = detailPost(id);
  const prefix =
    kind === 'outside-range'
      ? fixture.url + ' ' + fixture.prefix
      : fixture.prefix;
  const fullText = prefix + fixture.url;
  Object.assign(post.legacy, {
    full_text: fullText,
    is_quote_status: false,
    display_text_range: [
      kind === 'outside-range' ? Array.from(fixture.url + ' ').length : 0,
      Array.from(fullText).length,
    ],
    entities: {
      urls: [
        {
          url: fixture.url,
          expanded_url:
            kind === 'non-status'
              ? 'https://x.com/generated_status'
              : kind === 'video-path'
                ? fixture.expanded + '/video/1'
                : fixture.expanded,
          indices:
            kind === 'outside-range'
              ? [0, Array.from(fixture.url).length]
              : [Array.from(prefix).length, Array.from(fullText).length],
        },
      ],
      media: [],
    },
    extended_entities: { media: [] },
  });
  return detailAnswer(post);
}
export function statusEntityMarkup(
  id: string,
  kind: StatusEntityKind = 'match',
): string {
  const fixture = STATUS_ENTITY_FIXTURE;
  const href =
    kind === 'different-path'
      ? '/generated_status/status/902'
      : kind === 'non-status'
        ? '/generated_status'
        : kind === 'video-path'
          ? fixture.path + '/video/1'
          : kind === 'tco-anchor'
            ? fixture.url
            : fixture.path;
  const label =
    kind === 'video-path'
      ? fixture.label.replace('901…', '901/video/1…')
      : fixture.label;
  const link = `<a href="${href}"><div style="display:inline-flex"><span>https://</span></div><span>${label}</span></a>`;
  return `<article data-testid="tweet"><a href="/generated/status/${id}"><time>2026</time></a><div data-testid="tweetText">${fixture.prefix}${link}${kind === 'duplicate' ? `<span style="display:none">${link}</span>` : ''}</div></article>`;
}

export const FLOW_FIXTURE = {
  ids: ['910', '909', '908', '907', '906'],
  text: 'Generated flow text.',
  differentText: 'Generated different flow text.',
  reloadWaitMs: 60000,
  paceMs: 30000,
  slowWaitMs: 1000,
};
export function flowAnswer(id: string) {
  const post = detailPost(id);
  Object.assign(post.legacy, {
    full_text: FLOW_FIXTURE.text,
    display_text_range: [0, FLOW_FIXTURE.text.length],
    extended_entities: { media: [] },
  });
  return detailAnswer(post);
}
export function flowMarkup(id: string, mismatch = false): string {
  return `<article data-testid="tweet"><a href="/generated/status/${id}"><time>2026</time></a><div data-testid="tweetText">${mismatch ? FLOW_FIXTURE.differentText : FLOW_FIXTURE.text}</div></article>`;
}

export const OPTIONAL_NOTICE_FIXTURE = {
  first: 'Generated earlier notice.',
  protected: 'Generierter geschützter Hinweis. Mehr erfahren',
  extra: 'Generated wrapper notice with different text.',
};
export function optionalNoticeAnswer(focalId = '910', wrapped = true) {
  const notice = (text: string) => ({
    __typename: 'TweetTombstone',
    tombstone: { __typename: 'TextTombstone', text: { text } },
  });
  const inner = detailPost('902');
  delete (inner as Partial<typeof inner>).__typename;
  const entry = (id: string, result: unknown) => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result } } },
  });
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              entry('901', notice(OPTIONAL_NOTICE_FIXTURE.first)),
              ...(wrapped
                ? [
                    entry('902', {
                      __typename: 'TweetWithVisibilityResults',
                      tweet: inner,
                    }),
                  ]
                : []),
              entry('903', notice(OPTIONAL_NOTICE_FIXTURE.protected)),
              entry('904', detailPost('904')),
              entry(focalId, notice(OPTIONAL_NOTICE_FIXTURE.protected)),
              {
                entryId: 'cursor-generated',
                content: { cursorType: 'Bottom' },
              },
            ],
          },
        ],
      },
    },
  };
}
export function optionalNoticeMarkup(extra = true, wrongFocal = false): string {
  const notice = (text: string) =>
    `<div data-testid="cellInnerDiv"><div role="article">${text}</div></div>`;
  return (
    notice(OPTIONAL_NOTICE_FIXTURE.first) +
    (extra ? notice(OPTIONAL_NOTICE_FIXTURE.extra) : '') +
    notice(OPTIONAL_NOTICE_FIXTURE.protected) +
    '<article data-testid="tweet"><a href="/generated/status/904"><time>2026</time></a>Generated own post</article>' +
    notice(
      wrongFocal
        ? 'Generated wrong focal notice'
        : OPTIONAL_NOTICE_FIXTURE.protected,
    )
  );
}
