import { BASE_SECONDS, MAP_KEY, post, reels, variant } from './data.ts';
import type { Row } from './data.ts';

const MEDIA_KEY = ['media', 'list', 'data'].join('_');
const archive = 'instagram-synth_media-2026-07-31-c7d8e9';
const owner = 'synth_media_owner';

const unknownText = 'Invented text with an unknown translated label.';
const unknownComment: Row = {
  raw: {
    [MEDIA_KEY]: [{ uri: '' }],
    [MAP_KEY]: {
      'Unknown comment label': { value: unknownText },
      'Media Owner': { value: owner },
      Time: { timestamp: BASE_SECONDS + 7 },
    },
  },
  comment: {
    text: unknownText,
    owner,
    seconds: BASE_SECONDS + 7,
    mediaCount: 0,
  },
};
const unknownOwner: Row = {
  raw: {
    [MEDIA_KEY]: [
      { uri: 'https://media.example.com/synthetic_unknown_owner_07.gif' },
    ],
    [MAP_KEY]: {
      'Unknown owner label': { value: 'synth_unknown_media_owner' },
      Time: { timestamp: BASE_SECONDS + 8 },
    },
  },
  comment: null,
};
const unknownPlaceholderText =
  'Invented unknown-label text with a placeholder.';
const unknownPlaceholder: Row = {
  raw: {
    [MEDIA_KEY]: [{ uri: '' }],
    [MAP_KEY]: {
      'Unknown translated comment label': { value: unknownPlaceholderText },
      'Media Owner': { value: owner },
      Time: { timestamp: BASE_SECONDS + 10 },
    },
  },
  comment: {
    text: unknownPlaceholderText,
    owner,
    seconds: BASE_SECONDS + 10,
    mediaCount: 0,
  },
};

function mediaRow(
  text: string | null,
  owner: string | null,
  seconds: number,
  uris: string[] | null,
  mediaCount: number | undefined = uris?.length,
): Row {
  return {
    raw: {
      ...(uris === null ? {} : { [MEDIA_KEY]: uris.map((uri) => ({ uri })) }),
      [MAP_KEY]: {
        ...(text === null ? {} : { Comment: { value: text } }),
        ...(owner === null ? {} : { 'Media Owner': { value: owner } }),
        Time: { timestamp: seconds },
      },
    },
    // Author expectations directly from invented data, not parseComment.
    comment:
      text === null && (uris === null || uris.length === 0)
        ? null
        : { text: text ?? '', owner, seconds, mediaCount },
  };
}

// Only structure comes from S4. All text, handles and URIs here are invented.
// Public field-name sources are recorded in spikes/s4-real-exports/schema.ts.
export const mediaComments = variant(
  'media-comments',
  'Current-layout comments from S4 run 4 structural aggregates, invented values only: every post text row has one non-reference placeholder; uri="" is an assumption because S4 measured only neither link nor path, not emptiness. Media-only rows use invented example-domain HTTPS GIF links, plus one non-reference placeholder that stays importable with mediaCount 0. Same-second ordinal IDs, split overlap with a renamed URI, unknown-label placeholder text, one contentless rejected row and one unknown-owner usable-media rejection remain covered. D37 counts only usable references; expected counts are explicitly authored from invented data, never parsed. No entry has creation_timestamp. URI values never enter expected items; public field-name sources are in spikes/s4-real-exports/schema.ts.',
  [
    {
      name: `${archive}_1`,
      handle: 'synth_media',
      files: [
        post([
          mediaRow(
            'Invented comment without attachments.',
            owner,
            BASE_SECONDS,
            [''],
            0,
          ),
          mediaRow(
            'Another invented text-only comment.',
            owner,
            BASE_SECONDS + 1,
            [''],
            0,
          ),
          mediaRow(
            'Invented text with a media placeholder.',
            owner,
            BASE_SECONDS + 2,
            [''],
            0,
          ),
          mediaRow(null, owner, BASE_SECONDS + 3, [
            'https://media.example.com/synthetic_gif_02.gif',
          ]),
          mediaRow(null, owner, BASE_SECONDS + 3, [
            'https://media.example.com/synthetic_gif_03.gif',
          ]),
          mediaRow(null, null, BASE_SECONDS + 4, [
            'https://media.example.com/synthetic_gif_04.gif',
          ]),
          mediaRow(null, 'synth_shared_owner', BASE_SECONDS + 5, [
            'https://media.example.com/synthetic_overlap_05.gif',
          ]),
          mediaRow(null, owner, BASE_SECONDS + 6, null),
          unknownComment,
          unknownOwner,
          mediaRow(null, owner, BASE_SECONDS + 9, [''], 0),
          unknownPlaceholder,
        ]),
        reels([]),
      ],
    },
    {
      name: `${archive}_2`,
      handle: 'synth_media',
      files: [
        post([
          mediaRow(null, 'synth_shared_owner', BASE_SECONDS + 5, [
            'https://media.example.com/synthetic_overlap_renamed_06.gif',
          ]),
        ]),
      ],
    },
  ],
);
