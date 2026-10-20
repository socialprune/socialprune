import { expect, test } from 'vitest';
import type { InstagramContext } from '@socialprune/core';
import {
  automaticCanaryCheck,
  automaticReadbackCheck,
  compareSources,
} from './canary.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';
import { ContextStepReportSchema } from './report.ts';

test('C12 IG-9 otherName report count accepts only nonnegative integers', () => {
  for (const value of [0, 1, 45])
    expect(ContextStepReportSchema.parse({ otherName: value })).toEqual({
      otherName: value,
    });
  for (const value of [-1, 1.5, Infinity, IG_FIXTURE.other.username, null, {}])
    expect(() => ContextStepReportSchema.parse({ otherName: value })).toThrow();
});

test('C10 confirmedBy report token admits post and list only', () => {
  for (const confirmedBy of ['post', 'list'])
    expect(ContextStepReportSchema.parse({ confirmedBy })).toEqual({
      confirmedBy,
    });
  expect(() =>
    ContextStepReportSchema.parse({ confirmedBy: IG_FIXTURE.other.username }),
  ).toThrow();
});

test.each([
  'ownerLinksOneAccount',
  'ownerEqualsExport',
  'firstProfileNamesOwner',
])('C9 owner report schema keeps optional %s boolean-only', (field) => {
  expect(ContextStepReportSchema.parse({ result: 'owner' })).toEqual({
    result: 'owner',
  });
  for (const value of [true, false])
    expect(
      ContextStepReportSchema.parse({ result: 'owner', [field]: value }),
    ).toEqual({ result: 'owner', [field]: value });
  for (const value of [IG_FIXTURE.other.username, null, 1, {}])
    expect(() =>
      ContextStepReportSchema.parse({ result: 'owner', [field]: value }),
    ).toThrow();
});

const record: InstagramContext = {
  confirmedBy: 'post',
  itemId: 'instagram:generated',
  accountKey: 'instagram:generated',
  post: {
    kind: 'p',
    code: IG_FIXTURE.code,
    owner: 'generated_owner',
    ownerCount: 1,
    createdAt: IG_FIXTURE.postAt,
    caption: IG_FIXTURE.caption,
    captionComplete: true,
  },
  comment: {
    id: IG_FIXTURE.commentId,
    createdAt: IG_FIXTURE.postAt,
    expandClicks: 0,
  },
  image: { file: 'image.png', status: 'stored', host: 'a.cdninstagram.com' },
  screenshot: { file: 'shot.jpg', status: 'stored', bytes: 100 },
  confirmedAt: IG_FIXTURE.now,
  runId: 'generated',
  attemptId: 'generated',
};
const address = 'https://a.cdninstagram.com/generated.png?signature=secret';
const answer = {
  code: IG_FIXTURE.code,
  user: { username: record.post.owner },
  taken_at: Date.parse(IG_FIXTURE.postAt) / 1000,
  caption: { text: IG_FIXTURE.caption as string },
  image_versions2: { candidates: [{ url: address }] },
};
test.each([
  'instanceParams',
  'variables',
  'params',
  'route_match_infos',
] as const)(
  'C15 %s excludes every descendant code match even with media fields',
  (key) => {
    const route = { ...answer, caption: { text: IG_FIXTURE.other.text } };
    const fields = compareSources(record, address, [
      { [key]: [{ nested: route }] },
      answer,
    ]);
    expect(
      Object.values(fields).every((field) => field.found && field.agrees),
    ).toBe(true);
    expect(
      Object.values(
        compareSources(record, address, [{ [key]: { nested: route } }]),
      ).every((field) => !field.found && !field.agrees),
    ).toBe(true);
  },
);
test.each(['caption', 'shortcode'] as const)(
  'C15 a code object with only %s is not a post',
  (field) => {
    const decoy =
      field === 'caption'
        ? { code: IG_FIXTURE.code, caption: null }
        : { shortcode: IG_FIXTURE.code };
    expect(
      Object.values(compareSources(record, address, [decoy])).every(
        (field) => !field.found && !field.agrees,
      ),
    ).toBe(true);
    expect(
      Object.values(compareSources(record, address, [decoy, answer])).every(
        (field) => field.found && field.agrees,
      ),
    ).toBe(true);
  },
);
test.each(['owner', 'time', 'caption', 'image'] as const)(
  'C15 every real post must carry %s for a complete second source',
  (field) => {
    const partial: Record<string, unknown> = {
      ...answer,
      id: 'generated-real-post-id',
    };
    delete partial[
      (
        {
          owner: 'user',
          time: 'taken_at',
          caption: 'caption',
          image: 'image_versions2',
        } as const
      )[field]
    ];
    const fields = compareSources(record, address, [answer, partial]);
    expect(fields[field]).toMatchObject({ found: false, agrees: false });
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
        fields,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'CANARY_NO_SECOND_SOURCE' }),
    );
  },
);
test('C14 secondSource report validates every closed count path key and field flag', () => {
  const count = {
    responses: 1,
    bodies: 2,
    single: 0,
    sequence: 1,
    failed: 0,
    responsesWithCode: 1,
    bodiesWithCode: 1,
  };
  const secondSource = {
    contentTypes: {
      json: count,
      javascript: {
        ...count,
        responses: 0,
        bodies: 0,
        sequence: 0,
        responsesWithCode: 0,
        bodiesWithCode: 0,
      },
    },
    objects: [
      {
        path: 'data.items[]',
        keys: ['caption', 'code', 'user'],
        keysCapped: false,
        fields: { owner: true, time: false, caption: true, image: false },
      },
    ],
    objectsCapped: false,
    skippedParameters: 0,
  };
  expect(ContextStepReportSchema.parse({ secondSource })).toMatchObject({
    secondSource,
  });
  for (const changed of [
    { ...secondSource, skippedParameters: -1 },
    { ...secondSource, skippedParameters: 1.5 },
    { ...secondSource, skippedParameters: IG_FIXTURE.other.username },
    { ...secondSource, private: IG_FIXTURE.other.text },
    {
      ...secondSource,
      objects: [
        { ...secondSource.objects[0], path: IG_FIXTURE.other.username },
      ],
    },
    {
      ...secondSource,
      objects: [{ ...secondSource.objects[0], keys: [IG_FIXTURE.other.code] }],
    },
    {
      ...secondSource,
      objects: [
        {
          ...secondSource.objects[0],
          fields: {
            owner: IG_FIXTURE.other.username,
            time: false,
            caption: true,
            image: false,
          },
        },
      ],
    },
    {
      ...secondSource,
      contentTypes: { json: { ...count, failed: -1 }, javascript: count },
    },
    {
      ...secondSource,
      contentTypes: { json: { ...count, failed: 1.5 }, javascript: count },
    },
    {
      ...secondSource,
      objects: Array.from({ length: 65 }, () => secondSource.objects[0]),
    },
  ])
    expect(() =>
      ContextStepReportSchema.parse({ secondSource: changed }),
    ).toThrow();
});
test.each(['owner', 'time', 'caption', 'image'] as const)(
  'C14 incremental %s disagreement remains independent and refuses automatic acceptance',
  (field) => {
    const other = structuredClone(answer);
    if (field === 'owner') other.user.username = IG_FIXTURE.other.username;
    if (field === 'time') other.taken_at++;
    if (field === 'caption') other.caption.text = IG_FIXTURE.other.text;
    if (field === 'image')
      other.image_versions2.candidates[0]!.url =
        'https://a.cdninstagram.com/other';
    const checks = compareSources(record, address, [
      { data: { items: [answer] } },
      {
        path: ['media'],
        items: [{ ...other, code: undefined, shortcode: IG_FIXTURE.code }],
      },
    ]);
    expect(checks[field]).toMatchObject({ found: true, agrees: false });
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
        fields: checks,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CANARY_MISMATCH' }));
  },
);
test.each(['owner', 'time', 'caption', 'image'] as const)(
  'red-source %s requires presence and agreement independently',
  (field) => {
    const fields = compareSources(record, address, [answer]);
    fields[field] = { ...fields[field], found: false, agrees: false };
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
        fields,
      }),
    ).toThrow();
    fields[field] = { ...fields[field], found: true, agrees: false };
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
        fields,
      }),
    ).toThrow();
  },
);
test.each([
  'confirmed',
  'ownerShown',
  'timeShown',
  'imageStored',
  'screenshotStored',
] as const)('red-capture %s is required independently', (field) => {
  expect(() =>
    automaticCanaryCheck({
      confirmed: true,
      ownerShown: true,
      timeShown: true,
      imageStored: true,
      screenshotStored: true,
      fields: compareSources(record, address, [answer]),
      [field]: false,
    }),
  ).toThrow();
});
test('each stored field needs its own second source and exact normalized agreement', () => {
  const fields = compareSources(record, address, [answer]);
  expect(
    Object.values(fields).every((value) => value.found && value.agrees),
  ).toBe(true);
  expect(
    compareSources(record, address, [
      answer,
      {
        ...answer,
        image_versions2: {
          candidates: [
            { url: address },
            { url: 'https://a.cdninstagram.com/other' },
          ],
        },
      },
    ]).image.agrees,
  ).toBe(false);
  for (const [field, key] of [
    ['owner', 'user'],
    ['time', 'taken_at'],
    ['caption', 'caption'],
    ['image', 'image_versions2'],
  ] as const) {
    const missing = { ...answer } as Record<string, unknown>;
    delete missing[key];
    expect(compareSources(record, address, [missing])[field].found).toBe(false);
    const check = {
      confirmed: true,
      ownerShown: true,
      timeShown: true,
      imageStored: true,
      screenshotStored: true,
      fields: compareSources(record, address, [missing]),
    };
    expect(() => automaticCanaryCheck(check)).toThrow('second source');
    const mismatch = structuredClone(answer) as Record<string, unknown>;
    mismatch[key] =
      key === 'user'
        ? { username: 'different' }
        : key === 'taken_at'
          ? 1
          : key === 'caption'
            ? { text: 'different' }
            : { candidates: [{ url: 'https://a.cdninstagram.com/different' }] };
    expect(compareSources(record, address, [mismatch])[field].agrees).toBe(
      false,
    );
    expect(
      compareSources(record, address, [answer, mismatch])[field].agrees,
    ).toBe(false);
  }
  for (const key of [
    'confirmed',
    'ownerShown',
    'timeShown',
    'imageStored',
    'screenshotStored',
  ] as const)
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
        fields,
        [key]: false,
      }),
    ).toThrow();
  for (const values of [
    ['person', 'other', 0, 0, 0],
    ['person', 'person', 1, 0, 0],
    ['person', 'person', 0, 1, 0],
    ['person', 'person', 0, 0, 1],
  ] as const)
    expect(() =>
      automaticReadbackCheck(
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
      ),
    ).toThrow();
});
