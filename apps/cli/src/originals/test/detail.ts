export const DETAIL_FIXTURE = {
  id: '910',
  handle: 'generated_context',
  name: 'Generated context',
  text: 'Generated full original text',
  longText:
    'Generated full original text that continues beyond the anonymous beginning.',
  ownId: '1001',
  forbidden: [
    'generated-viewer-secret',
    'generated-reply-secret',
    'generated-follow-secret',
  ],
  media: [
    {
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/generated-poster.jpg',
      ext_alt_text: 'Generated alternative',
      video_info: {
        duration_millis: 1200,
        variants: [
          {
            content_type: 'video/mp4',
            bitrate: 832000,
            url: 'https://video.twimg.com/generated-low.mp4',
          },
          {
            content_type: 'video/mp4',
            bitrate: 2176000,
            url: 'https://video.twimg.com/generated-high.mp4',
          },
          {
            content_type: 'application/x-mpegURL',
            url: 'https://video.twimg.com/generated.m3u8',
          },
        ],
      },
    },
  ],
};
export function detailPost(id = DETAIL_FIXTURE.id) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    legacy: {
      full_text: DETAIL_FIXTURE.text,
      created_at: 'Sun Oct 11 12:00:00 +0000 2026',
      conversation_id_str: '901',
      extended_entities: { media: [] },
    },
    core: {
      user_results: {
        result: {
          core: {
            screen_name: DETAIL_FIXTURE.handle,
            name: DETAIL_FIXTURE.name,
          },
        },
      },
    },
    favorited: true,
    viewer_secret: DETAIL_FIXTURE.forbidden[0],
  };
}
export function detailAnswer(
  post: unknown = detailPost(),
  above: unknown[] = [],
) {
  const entry = (value: unknown) => ({
    entryId: `tweet-${(value as { rest_id?: string }).rest_id ?? DETAIL_FIXTURE.id}`,
    content: { itemContent: { tweet_results: { result: value } } },
  });
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              ...above.map(entry),
              entry(post),
              {
                entryId: 'tweet-999',
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        ...detailPost('999'),
                        legacy: { full_text: DETAIL_FIXTURE.forbidden[1] },
                      },
                    },
                  },
                },
              },
              {
                entryId: 'cursor-bottom-generated',
                content: { cursorType: 'Bottom' },
              },
            ],
          },
        ],
      },
    },
    viewer: DETAIL_FIXTURE.forbidden[2],
  };
}
