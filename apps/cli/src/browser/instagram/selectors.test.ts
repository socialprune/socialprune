import { expect, test } from 'vitest';
import type { PostProjection } from './selectors.ts';
import type { Page } from 'playwright-core';
import {
  confirmComment,
  rowCandidate,
  utcWindow,
  postAddress,
  readRows,
  relativeAgeMs,
  accountMatches,
  outsideProfilePaths,
} from './selectors.ts';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';

test('C12 IG-9 pure account check requires exact outside profile path and a strict row majority', () => {
  const own = 'generated_person',
    other = IG_FIXTURE.other.username;
  for (const [names, expected] of [
    [[own, own, other], true],
    [[own.toUpperCase(), own, own, other], true],
    [[own, other], false],
    [[own, other, other], false],
    [[], false],
  ] as const)
    expect(
      accountMatches(
        own,
        [`/${own.toUpperCase()}/`],
        names.map((username) => ({ username })),
      ),
    ).toBe(expected);
  for (const path of [
    `/${other}/`,
    `/${own}`,
    `/${own}/extra/`,
    `/${own}/?q=1`,
    `/${own}/#profile`,
    `https://www.instagram.com/${own}/`,
    `//${own}/`,
    '',
  ])
    expect(accountMatches(own, [path], [{ username: own }])).toBe(false);
});

test('C12 revision outside-main locator reads preserve exact path and same-origin href checks', async () => {
  const handle = 'generated_person',
    origin = 'https://www.instagram.com';
  for (const [href, expected] of [
    [`/${handle}/`, true],
    [`${origin}/${handle.toUpperCase()}/`, true],
    [`/${IG_FIXTURE.other.username}/`, false],
    [`/${handle}`, false],
    [`/${handle}/extra/`, false],
    [`/${handle}/?q=1`, false],
    [`/${handle}/?`, false],
    [`/${handle}/#profile`, false],
    [`/${handle}/#`, false],
    [`https://other.invalid/${handle}/`, false],
    [`https://www.instagram.com.other.invalid/${handle}/`, false],
    [`https://user@www.instagram.com/${handle}/`, false],
    [`//www.instagram.com/${handle}/`, false],
    ['http://[', false],
    ['', false],
    [null, false],
  ] as const) {
    const page = {
      url: () => origin + '/your_activity/interactions/comments',
      locator: (selector: string) => {
        expect(selector).toBe('xpath=//a[@href][not(ancestor::main)]');
        return {
          all: () =>
            Promise.resolve([
              {
                getAttribute: (attribute: string) => {
                  expect(attribute).toBe('href');
                  return Promise.resolve(href);
                },
              },
            ]),
        };
      },
    } as unknown as Page;
    expect(
      accountMatches(handle, await outsideProfilePaths(page), [
        { username: handle },
      ]),
    ).toBe(expected);
  }
});

test.each(
  (['p', 'reel'] as const).flatMap((kind) =>
    ['', '/'].map((slash) => ({ kind, slash })),
  ),
)(
  'C7 post address accepts $kind with closing slash "$slash"',
  ({ kind, slash }) => {
    expect(
      postAddress(
        `https://www.instagram.com/${kind}/${IG_FIXTURE.code}${slash}`,
        'https://www.instagram.com',
      ),
    ).toEqual({ kind, code: IG_FIXTURE.code });
  },
);
test.each([
  `https://www.instagram.com/p/${IG_FIXTURE.code}/?q=1`,
  `https://www.instagram.com/p/${IG_FIXTURE.code}?q=1`,
  `https://www.instagram.com/p/${IG_FIXTURE.code}/?`,
  `https://www.instagram.com/p/${IG_FIXTURE.code}/#comment`,
  `https://www.instagram.com/p/${IG_FIXTURE.code}/extra/`,
  `https://www.instagram.com/p/${IG_FIXTURE.code}/c/123/`,
  `https://other.invalid/p/${IG_FIXTURE.code}/`,
  `https://www.instagram.com.other.invalid/p/${IG_FIXTURE.code}/`,
  `https://www.instagram.com:444/p/${IG_FIXTURE.code}/`,
  `https://user@www.instagram.com/p/${IG_FIXTURE.code}/`,
  'https://www.instagram.com/p/a%2Fb/',
  'https://www.instagram.com/p/' + 'a'.repeat(65),
  'https://www.instagram.com/p//',
])('C7 post address refuses noncanonical input %s', (input) => {
  expect(postAddress(input, 'https://www.instagram.com')).toBeNull();
});

test('C4 row scans skip normalized-empty buttons, preserve original indices and reject nonempty unknown ages', async () => {
  let texts = [
    '',
    ' \n ',
    'generated_person A generated first comment\n8y',
    'generated_person Another generated comment\n8 years',
    'generated_person Generated week\n1w',
    'generated_person Generated day\n2d',
  ];
  const locator = {
    filter: () => locator,
    allInnerTexts: () => Promise.resolve(texts),
  };
  const page = { locator: () => locator } as unknown as Page,
    counts = { emptySkipped: 0, otherName: 0 };
  expect(
    (await readRows(page, counts)).map((row) => [
      row.username,
      row.age,
      row.index,
    ]),
  ).toEqual([
    ['generated_person', '8y', 2],
    ['generated_person', '8 years', 3],
    ['generated_person', '1w', 4],
    ['generated_person', '2d', 5],
  ]);
  expect(counts.emptySkipped).toBe(2);
  await readRows(page, counts);
  expect(counts.emptySkipped).toBe(2);
  texts = ['', 'generated_person A generated malformed comment\n8q'];
  await expect(readRows(page, counts)).rejects.toMatchObject({
    code: 'INSTAGRAM_SHAPE_CHANGED',
    token: 'row-structure',
  });
});
test('C4 relative age years use one coarse diagnostic conversion and never alter exact comment checks', () => {
  for (const age of ['1y', '1 year', '1 years'])
    expect(relativeAgeMs(age)).toBe(31557600000);
  expect(relativeAgeMs('8y')).toBe(8 * 31557600000);
  expect(relativeAgeMs('8 years')).toBe(8 * 31557600000);
  for (const [age, expected] of [
    ['2w', 1209600000],
    ['2 weeks', 1209600000],
    ['2d', 172800000],
    ['2 days', 172800000],
    ['2h', 7200000],
    ['2 hours', 7200000],
    ['2m', 120000],
    ['2 minutes', 120000],
    ['2s', 2000],
    ['2 seconds', 2000],
  ] as const)
    expect(relativeAgeMs(age)).toBe(expected);
  for (const age of ['8q', '8months', '8y trailing'])
    expect(relativeAgeMs(age)).toBeNull();
});

test.each(['owner', 'author', 'text', 'time', 'several'] as const)(
  'red-check %s independently rejects a planted wrong match',
  async (field) => {
    const { items } = await instagramFixture(),
      item = items[0]!;
    const comment = {
      username: item.account.handle!,
      text: item.text,
      id: IG_FIXTURE.commentId,
      createdAt: item.createdAt,
    };
    const post = {
      kind: 'p',
      code: IG_FIXTURE.code,
      owner: item.reference.ownerHandle!,
      ownerCount: 1,
      ownerMatchesProfile: true,
      caption: IG_FIXTURE.caption,
      captionComplete: true,
      createdAt: IG_FIXTURE.postAt,
      comments: [comment],
    } as PostProjection;
    if (field === 'owner') post.owner = 'wrong-generated-owner';
    if (field === 'author') comment.username = IG_FIXTURE.other.username;
    if (field === 'text') comment.text = 'Wrong generated text';
    if (field === 'time')
      comment.createdAt = new Date(
        Date.parse(item.createdAt) + 60001,
      ).toISOString();
    if (field === 'several')
      post.comments.push({ ...comment, id: '2828282828' });
    expect(confirmComment(post, item, item.account.handle!).state).toBe(
      'unconfirmed',
    );
  },
);
test('author, full normalized text, 60 second time and first owner are independent confirmation checks', async () => {
  const { items } = await instagramFixture(),
    item = items[0]!;
  const base = {
    kind: 'p',
    code: IG_FIXTURE.code,
    owner: item.reference.ownerHandle!,
    ownerCount: 1,
    ownerMatchesProfile: true,
    caption: IG_FIXTURE.caption,
    captionComplete: true,
    createdAt: IG_FIXTURE.postAt,
    comments: [
      {
        username: item.account.handle!,
        text: item.text,
        id: IG_FIXTURE.commentId,
        createdAt: item.createdAt,
      },
    ],
  } as PostProjection;
  expect(confirmComment(base, item, item.account.handle!).state).toBe(
    'confirmed',
  );
  for (const [change, code] of [
    [{ owner: 'different' }, 'owner'],
    [
      {
        comments: [
          {
            ...base.comments[0]!,
            createdAt: new Date(
              Date.parse(item.createdAt) + 60001,
            ).toISOString(),
          },
        ],
      },
      'time',
    ],
    [{ comments: [{ ...base.comments[0]!, text: 'Different text' }] }, 'text'],
    [
      {
        comments: [
          { ...base.comments[0]!, username: IG_FIXTURE.other.username },
        ],
      },
      'not-shown',
    ],
    [
      { comments: [...base.comments, { ...base.comments[0]!, id: '282828' }] },
      'several',
    ],
  ] as const)
    expect(
      confirmComment(
        {
          ...base,
          ...change,
          comments: change.comments ? [...change.comments] : base.comments,
        },
        item,
        item.account.handle!,
      ),
    ).toMatchObject({ state: 'unconfirmed', code });
  expect(
    confirmComment(
      {
        ...base,
        comments: [
          {
            ...base.comments[0]!,
            createdAt: new Date(
              Date.parse(item.createdAt) + 60000,
            ).toISOString(),
          },
        ],
      },
      item,
      item.account.handle!,
    ).state,
  ).toBe('confirmed');
  expect(rowCandidate(item.text.slice(0, 23) + '...', item.text)).toBe(true);
  expect(rowCandidate('Short...', item.text)).toBe(false);
  expect(utcWindow('2025-07-31T00:00:00.000Z')).toEqual([
    '2025-07-30',
    '2025-08-01',
  ]);
  expect(
    postAddress(
      'https://www.instagram.com/reel/A_-19/',
      'https://www.instagram.com',
    ),
  ).toEqual({ kind: 'reel', code: 'A_-19' });
  for (const path of [
    '/p/../',
    '/p/a/c/99/',
    '/p/a%2Fb/',
    '/p/' + 'a'.repeat(65) + '/',
  ])
    expect(
      postAddress(
        'https://www.instagram.com' + path,
        'https://www.instagram.com',
      ),
    ).toBeNull();
});
