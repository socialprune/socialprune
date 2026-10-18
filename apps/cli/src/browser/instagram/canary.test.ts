import { expect, test } from 'vitest';
import type { InstagramContext } from '@socialprune/core';
import {
  automaticCanaryCheck,
  automaticReadbackCheck,
  compareSources,
} from './canary.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';
import { ContextStepReportSchema } from './report.ts';

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
  caption: { text: IG_FIXTURE.caption },
  image_versions2: { candidates: [{ url: address }] },
};
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
