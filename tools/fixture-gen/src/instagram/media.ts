import { BASE_SECONDS, MAP_KEY, post, reels, variant } from './data.ts';
import type { Row } from './data.ts';

const MEDIA_KEY = ['media', 'list', 'data'].join('_');
const archive = 'instagram-synth_media-2026-07-31-c7d8e9';
const owner = 'synth_media_owner';

const unknownText = 'Invented text with an unknown translated label.';
const unknownComment: Row = {
  raw: {
    [MEDIA_KEY]: [],
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
    [MEDIA_KEY]: [{ uri: 'media/other/synthetic_unknown_owner_07.gif' }],
    [MAP_KEY]: {
      'Unknown owner label': { value: 'synth_unknown_media_owner' },
      Time: { timestamp: BASE_SECONDS + 8 },
    },
  },
  comment: null,
};

function mediaRow(
  text: string | null,
  owner: string | null,
  seconds: number,
  uris: string[] | null,
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
        : { text: text ?? '', owner, seconds, mediaCount: uris?.length },
  };
}

// Only structure comes from S4. All text, handles and URIs here are invented.
// Public field-name sources are recorded in spikes/s4-real-exports/schema.ts.
export const mediaComments = variant(
  'media-comments',
  'Current-layout media-only shapes A/B from S4 structural facts, invented values only: empty lists on text comments, text plus media, absent text with/without owner, same-second ordinal IDs, split overlap with renamed URI, one contentless rejected row, unknown comment label with an empty media list accepted, and unknown owner label with positive media rejected as ambiguous (D34). URI values never enter expected items; counts come from authored media lists. Public media_list_data and uri field-name sources are in spikes/s4-real-exports/schema.ts.',
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
            [],
          ),
          mediaRow(
            'Another invented text-only comment.',
            owner,
            BASE_SECONDS + 1,
            [],
          ),
          mediaRow('Invented comment with a GIF.', owner, BASE_SECONDS + 2, [
            'media/other/synthetic_gif_01.gif',
          ]),
          mediaRow(null, owner, BASE_SECONDS + 3, [
            'media/other/synthetic_gif_02.gif',
          ]),
          mediaRow(null, owner, BASE_SECONDS + 3, [
            'media/other/synthetic_sticker_03.webp',
          ]),
          mediaRow(null, null, BASE_SECONDS + 4, [
            'media/other/synthetic_image_04.png',
          ]),
          mediaRow(null, 'synth_shared_owner', BASE_SECONDS + 5, [
            'media/other/synthetic_overlap_05.gif',
          ]),
          mediaRow(null, owner, BASE_SECONDS + 6, null),
          unknownComment,
          unknownOwner,
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
            'media/other/synthetic_overlap_renamed_06.gif',
          ]),
        ]),
      ],
    },
  ],
);
