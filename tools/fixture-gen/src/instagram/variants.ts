import type { Variant } from '../shared/index.ts';
import {
  BASE_SECONDS,
  CURRENT,
  MAP_KEY,
  PERSONAL,
  PRIMARY,
  SECONDARY,
  personal,
  post,
  reels,
  row,
  variant,
} from './data.ts';
import type { File, Row } from './data.ts';

const primary = (files: File[]) => ({
  name: PRIMARY,
  handle: 'synth_fern',
  files,
});
const a = () => row('Invented fern photo comment.');
const b = () =>
  row('Invented orbit photo comment.', 'synth_orbit', BASE_SECONDS + 1);
const c = () => row('Invented reel comment.', 'synth_reed', BASE_SECONDS + 2);
const bad: Row = {
  raw: {
    [MAP_KEY]: { Comment: { value: 17 }, Time: { timestamp: BASE_SECONDS } },
  },
  comment: null,
};
const unknown: Row = {
  raw: {
    [MAP_KEY]: {
      'Unknown text label': { value: 'Unknown label comment.' },
      'Unknown time label': { timestamp: BASE_SECONDS },
      'Media Owner': { value: 'synth_moss' },
    },
  },
  comment: {
    text: 'Unknown label comment.',
    owner: 'synth_moss',
    seconds: BASE_SECONDS,
  },
};
const ambiguous: Row = {
  raw: {
    [MAP_KEY]: {
      'Unknown text label': { value: 'Do not guess this field.' },
      'Unknown owner label': { value: 'synth_moss' },
      Time: { timestamp: BASE_SECONDS },
    },
  },
  comment: null,
};

export const variants: Variant[] = [
  variant(
    'current-minimal',
    'One current post-comment array; English envelope sourced from picnic 2025-07-31 snapshot; reels omitted.',
    [primary([post([a()])])],
  ),
  variant(
    'current-parts-reels',
    'Numbered post files sort numerically (1, 2, 10), then reels; sharding sourced, reels object wrapper supplied by task and needs S4 verification.',
    [
      primary([
        post([a()], 1),
        post([b()], 2),
        post(
          [row('Invented tenth part.', 'synth_moss', BASE_SECONDS + 10)],
          10,
        ),
        reels([c()]),
      ]),
    ],
  ),
  variant(
    'current-reels-array',
    'Bare reels array follows picnic snapshot, unlike task-provided wrapped form; both variants must import.',
    [primary([post([a()]), reels([c()], CURRENT, true)])],
  ),
  variant(
    'mojibake',
    'Manufactured Latin-1 byte text and owner strings with umlauts and emoji next to native Unicode, mixed encodings and suspicious non-UTF-8 bytes; repair rule sourced from Robin parser.',
    [
      primary([
        post([
          row(
            'Grüße aus dem erfundenen Garten 🌿',
            'synth_grün_🌱',
            BASE_SECONDS,
            { mangled: true },
          ),
          row('ä', 'synth_native', BASE_SECONDS + 1),
          row('Correct emoji 🐸', 'synth_emoji', BASE_SECONDS + 2),
          row(
            'Mangled segment Ã¤ plus native ä',
            'synth_mixed',
            BASE_SECONDS + 3,
          ),
          row(
            'Suspicious Ã without valid bytes',
            'synth_plain',
            BASE_SECONDS + 4,
          ),
        ]),
        reels([]),
      ]),
    ],
  ),
  variant(
    'german-labels',
    'Kommentar, Zeit and Medieninhaber aliases are task-provided assumptions; no English labels or sibling owner, reordered labels need type checks.',
    [
      primary([
        post([
          row('Erfundener deutscher Kommentar.', 'synth_moos', BASE_SECONDS, {
            german: true,
            sibling: false,
          }),
        ]),
        reels([]),
      ]),
    ],
  ),
  variant(
    'unknown-labels',
    'Unknown text/time labels parse only with one remaining typed string slot and a resolved owner; this fallback is a compatibility assumption.',
    [primary([post([unknown]), reels([])])],
  ),
  variant(
    'ambiguous-labels',
    'Two unknown string slots are ambiguous and must be unreadable, not guessed from dictionary order; readable reels still import.',
    [primary([post([ambiguous]), reels([c()])])],
  ),
  variant(
    'root-comments',
    'Root comments/post_comments_1.json folder is a historical compatibility assumption, not dated format evidence; S4 must verify it.',
    [primary([post([a()], 1, 'comments'), reels([c()], 'comments')])],
    'json-root-comments',
  ),
  variant(
    'activity-comments',
    'activity/comments folder is a requested historical compatibility assumption; no claimed 2022/2024 comment-folder dates.',
    [
      primary([
        post([a()], 1, 'activity/comments'),
        reels([c()], 'activity/comments'),
      ]),
    ],
    'json-activity',
  ),
  variant(
    'legacy-comments',
    'Pre-envelope root comments.json media_comments triples sourced from MIT instagram_json_viewer; explicit-offset ISO dates are a tested assumption; story/live arrays are ignored.',
    [
      primary([
        {
          path: 'comments.json',
          category: 'post-comments',
          rows: [
            {
              raw: [
                '2025-07-31T00:00:00+00:00',
                'Invented legacy comment.',
                'synth_old',
              ],
              comment: {
                text: 'Invented legacy comment.',
                owner: 'synth_old',
                seconds: BASE_SECONDS,
              },
            },
          ],
          content:
            JSON.stringify(
              {
                media_comments: [
                  [
                    '2025-07-31T00:00:00+00:00',
                    'Invented legacy comment.',
                    'synth_old',
                  ],
                ],
                story_comments: [
                  [
                    '2025-07-31T00:00:00+00:00',
                    'STORY_ONLY_MARKER',
                    'synth_story',
                  ],
                ],
                live_comments: [],
              },
              null,
              2,
            ) + '\n',
        },
      ]),
    ],
    'json-legacy',
  ),
  variant(
    'top-level-folder',
    'Single enclosing folder matches picnic archive-root description; provenance keeps it but item IDs do not depend on it.',
    [
      primary(
        [post([a()]), reels([c()])].map((file) => ({
          ...file,
          path: `${PRIMARY}/${file.path}`,
        })),
      ),
    ],
  ),
  variant(
    'two-accounts',
    'Two invented archive-name handles remain distinct accounts even when comment fields are identical; same format in both ZIPs.',
    [
      primary([post([a()]), reels([])]),
      {
        name: SECONDARY,
        handle: 'synth_orbit',
        files: [post([a()]), reels([])],
      },
    ],
  ),
  variant(
    'split-overlap',
    'Two named parts of one account share one comment; per-archive ordinal IDs union overlap; exact _1/_2 token suffix is an assumption for S4.',
    [
      { name: `${PRIMARY}_1`, handle: 'synth_fern', files: [post([a(), b()])] },
      {
        name: `${PRIMARY}_2`,
        handle: 'synth_fern',
        files: [post([a(), c()]), reels([])],
      },
    ],
  ),
  variant(
    'identical-comments',
    'Three equal comments in one second across two numbered files keep first ID plus ordinals 2 and 3; missing upstream IDs require this multiplicity policy.',
    [primary([post([a(), a()]), post([a()], 2), reels([])])],
  ),
  variant(
    'split-multiplicity',
    'Overlap preserves maximum observed multiplicity, not one item per fingerprint; first part has two equal comments and second has three.',
    [
      { name: `${PRIMARY}_1`, handle: 'synth_fern', files: [post([a(), a()])] },
      {
        name: `${PRIMARY}_2`,
        handle: 'synth_fern',
        files: [post([a(), a(), a()]), reels([])],
      },
    ],
  ),
  variant(
    'personal-fallback',
    'Unknown archive name falls back only to profile_user Username; nested path sourced from picnic and HPI; invented email, phone, name and bio never leave input.',
    [
      {
        name: 'instagram-profile-fallback',
        handle: 'synth_profile',
        accountFile: PERSONAL,
        files: [personal('synth_profile'), post([a()]), reels([])],
      },
    ],
  ),
  variant(
    'personal-german',
    'Benutzername alias sourced from Robin parser; profile fallback never guesses from Email, Name or phone field types.',
    [
      {
        name: 'instagram-profile-german',
        handle: 'synth_profil',
        accountFile: PERSONAL,
        files: [personal('synth_profil', PERSONAL, true), post([a()])],
      },
    ],
  ),
  ...[
    [
      'account-pre2022',
      'account_information/personal_information.json',
      'HPI sources this account folder before the Feb-Aug 2022 rename; root comment folder itself remains a compatibility assumption.',
    ],
    [
      'account-2022',
      'personal_information/personal_information.json',
      'HPI sources this account folder after Feb-Aug 2022 and before the extra nesting around Apr 2024.',
    ],
  ].map(([id, path, description]) =>
    variant(
      id!,
      description!,
      [
        {
          name: `instagram-${id!}-fallback`,
          handle: 'synth_history',
          accountFile: path!,
          files: [personal('synth_history', path), post([a()], 1, 'comments')],
        },
      ],
      'json-root-comments',
    ),
  ),
  variant(
    'unknown-account',
    'Missing account metadata gets archive-specific SHA-256 key and null handle, never content-derived identity.',
    [
      {
        name: 'instagram-anonymous-export',
        handle: null,
        files: [post([a()])],
      },
    ],
  ),
  variant(
    'empty-account',
    'Empty profile_user array is empty account metadata, distinct from missing and malformed; comments still import under archive key.',
    [
      {
        name: 'instagram-empty-profile',
        handle: null,
        accountStatus: 'empty',
        accountFile: PERSONAL,
        files: [
          { path: PERSONAL, content: '{"profile_user":[]}' },
          post([a()]),
        ],
      },
    ],
  ),
  variant(
    'unreadable-account',
    'Malformed profile metadata yields partial status and archive-key fallback without exposing parse errors or profile content.',
    [
      {
        name: 'instagram-broken-profile',
        handle: null,
        accountStatus: 'unreadable',
        accountFile: PERSONAL,
        files: [
          {
            path: PERSONAL,
            content: '{"profile_user": [ BROKEN_PROFILE_ONLY_MARKER',
          },
          post([a()]),
        ],
      },
    ],
  ),
  variant(
    'missing-reels',
    'Missing reels file is missing, not empty or unreadable; a valid post still imports.',
    [primary([post([a()])])],
  ),
  variant(
    'empty-comments',
    'Two present empty arrays are empty categories with zero items; empty is not missing or unreadable.',
    [primary([post([]), reels([])])],
  ),
  variant(
    'missing-comments',
    'Profile marker identifies Instagram even when both comment categories are absent; no personal read when archive name supplies handle.',
    [primary([personal('synth_fern')])],
  ),
  variant(
    'malformed-comments',
    'Valid first post row survives a truncated next row, category unreadable and summary partial; separate valid reels import.',
    [
      primary([
        {
          ...post([a()]),
          content: '[' + JSON.stringify(a().raw) + ', {"broken":',
          unreadable: true,
        },
        reels([c()]),
      ]),
    ],
  ),
  variant(
    'invalid-row',
    'Wrong typed text in one row is unreadable while other rows and reels continue; invalid timestamp/alias inputs are also unit-tested.',
    [primary([post([a(), bad]), reels([c()])])],
  ),
  variant(
    'html-only',
    'Comments present only in HTML report html-export and request JSON; HTML is never read or parsed.',
    [
      primary([
        {
          path: `${CURRENT}/post_comments_1.html`,
          content: '<html>HTML_ONLY_MARKER</html>',
        },
      ]),
    ],
    'html',
    'html-export',
  ),
  variant(
    'private-distractors',
    'Messages, login, devices, contacts, captions and likes are outside the allowlist; private folders also contain comment/profile lookalikes to prove they are not opened or reported.',
    [
      primary([
        post([a()]),
        reels([c()]),
        personal('synth_fern'),
        {
          path: 'your_instagram_activity/messages/inbox/synth_private_thread/message_1.json',
          content: '{"messages":[{"content":"PRIVATE_CHAT_ONLY_MARKER"}]}',
        },
        {
          path: 'your_instagram_activity/messages/inbox/synth_private_thread/comments/post_comments_1.json',
          content: post([row('PRIVATE_SHADOW_ONLY_MARKER')]).content,
        },
        {
          path: 'your_instagram_activity/messages/personal_information/personal_information/personal_information.json',
          content: personal('synth_shadow').content,
        },
        {
          path: 'security_and_login_information/login_and_profile_creation/login_activity.json',
          content: '{"login":"PRIVATE_LOGIN_ONLY_MARKER","ip":"192.0.2.9"}',
        },
        {
          path: 'personal_information/device_information/devices.json',
          content: '{"device":"PRIVATE_DEVICE_ONLY_MARKER"}',
        },
        {
          path: 'contacts/contacts.json',
          content: '{"email":"synth_contact_only@example.com"}',
        },
        {
          path: 'your_instagram_activity/media/posts_1.json',
          content: '[{"title":"CAPTION_ONLY_MARKER"}]',
        },
        {
          path: 'your_instagram_activity/likes/liked_posts.json',
          content: '{"likes": ["LIKES_ONLY_MARKER"]}',
        },
        {
          path: `__MACOSX/${CURRENT}/post_comments_1.json`,
          content: post([row('MACOS_ONLY_MARKER')]).content,
        },
      ]),
    ],
  ),
  variant(
    'no-match',
    'Unrelated JSON archive with a generic root comments.json must not be mistaken for Instagram or read.',
    [
      {
        name: 'unrelated-synthetic-archive',
        handle: null,
        files: [
          { path: 'notes.json', content: '{"note":"UNRELATED_ONLY_MARKER"}' },
          { path: 'comments.json', content: '{"media_comments": []}' },
        ],
      },
    ],
    'none',
    'unknown-format',
  ),
];
