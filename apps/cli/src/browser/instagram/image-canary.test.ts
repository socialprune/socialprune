import { describe, expect, test } from 'vitest';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
import {
  imageCase,
  IMAGE_CASES,
} from '../../../e2e/fake-instagram/image-cases.ts';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import { automaticCanaryCheck, compareSources } from './canary.ts';
import { imageDiagnostic } from './canary.ts';
test('IG-IMAGE A keeps every-object membership and scalar conflicts instead of taking a union', async () => {
  const { items } = await instagramFixture();
  const shape = imageCase(
    'extra-rendition-common-url',
    items[0]!,
    'https://generated.cdninstagram.com',
  );
  const record = instagramContractRecord(items[0]);
  Object.assign(record.post, {
    code: IG_FIXTURE.code,
    createdAt: IG_FIXTURE.postAt,
    caption: IG_FIXTURE.caption,
  });
  expect(compareSources(record, shape.first, [shape.body]).image.agrees).toBe(
    true,
  );
  for (const change of [
    { user: { username: IG_FIXTURE.other.username } },
    { taken_at: Date.parse(IG_FIXTURE.other.time) / 1000 },
    { caption: { text: IG_FIXTURE.other.text } },
    { image_versions2: { candidates: [{ url: shape.second }] } },
    { image_versions2: { candidates: [] } },
  ]) {
    const body = structuredClone(shape.body);
    Object.assign(body.media!, change);
    const fields = compareSources(record, shape.first, [body]);
    expect(() =>
      automaticCanaryCheck({
        confirmed: true,
        fields,
        ownerShown: true,
        timeShown: true,
        imageStored: true,
        screenshotStored: true,
      }),
    ).toThrow();
  }
});

test('IG-IMAGE diagnostic counts qualifying focal objects and exact-url candidate lists without leaking addresses', async () => {
  const { items } = await instagramFixture();
  const shape = imageCase(
    'extra-rendition-common-url',
    items[0]!,
    'https://generated.cdninstagram.com',
  );
  const diagnostic = imageDiagnostic;
  expect(diagnostic(IG_FIXTURE.code, shape.first, [shape.body])).toEqual({
    carouselPosition: null,
    carouselFirstSlide: null,
    qualifyingObjects: 2,
    matchingLists: 2,
    distinctListLengths: [1, 2],
    source: 'img-current-src',
  });
  expect(diagnostic(IG_FIXTURE.code, null, [shape.body])).toEqual({
    carouselPosition: null,
    carouselFirstSlide: null,
    qualifyingObjects: 2,
    matchingLists: 0,
    distinctListLengths: [1, 2],
    source: 'none',
  });
  const partial = imageCase(
    'partial-matching-post',
    items[0]!,
    'https://generated.cdninstagram.com',
  );
  expect(diagnostic(IG_FIXTURE.code, partial.first, [partial.body])).toEqual({
    carouselPosition: null,
    carouselFirstSlide: null,
    qualifyingObjects: 2,
    matchingLists: 1,
    distinctListLengths: [1],
    source: 'img-current-src',
  });
});

describe('IMAGE-2 carousel slide', () => {
  const host = 'https://generated.cdninstagram.com';
  const OWNER = 'generated_carousel_owner';
  const slide = (n: number) =>
    `${host}/generated-slide-${n}.jpg?sig=generated${n}`;
  const item = (n: number) => ({
    id: `generated-item-${n}`,
    image_versions2: {
      candidates: [{ url: slide(n) }, { url: `${slide(n)}&s=low` }],
    },
  });
  const post = (overrides: Record<string, unknown> = {}) => ({
    code: IG_FIXTURE.code,
    id: 'generated-post-id',
    user: { username: OWNER },
    taken_at: Date.parse(IG_FIXTURE.postAt) / 1000,
    caption: { text: IG_FIXTURE.caption },
    carousel_media: [item(1), item(2), item(3)],
    ...overrides,
  });
  async function record() {
    const { items } = await instagramFixture();
    const value = instagramContractRecord(items[0]);
    Object.assign(value.post, {
      code: IG_FIXTURE.code,
      owner: OWNER,
      createdAt: IG_FIXTURE.postAt,
      caption: IG_FIXTURE.caption,
      captionComplete: true,
    });
    return value;
  }
  const check = (fields: ReturnType<typeof compareSources>) => ({
    confirmed: true,
    fields,
    ownerShown: true,
    timeShown: true,
    imageStored: true,
    screenshotStored: true,
  });
  test('slide 2 captured agrees and the report records position 2, not the first slide', async () => {
    const body = { data: { items: [post()] } };
    const fields = compareSources(await record(), slide(2), [body]);
    expect(
      fields.owner.agrees && fields.time.agrees && fields.caption.agrees,
    ).toBe(true);
    expect(fields.image).toMatchObject({ found: true, agrees: true });
    expect(() => automaticCanaryCheck(check(fields))).not.toThrow();
    const diagnostic = imageDiagnostic(IG_FIXTURE.code, slide(2), [body]);
    expect(diagnostic).toMatchObject({
      carouselPosition: 2,
      carouselFirstSlide: false,
      qualifyingObjects: 1,
      matchingLists: 0,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(host);
  });
  test('an address in no carousel item stays a mismatch', async () => {
    const body = { data: { items: [post()] } };
    const fields = compareSources(await record(), slide(9), [body]);
    expect(fields.image).toMatchObject({ found: true, agrees: false });
    expect(() => automaticCanaryCheck(check(fields))).toThrowError(
      expect.objectContaining({ code: 'CANARY_MISMATCH' }),
    );
    expect(imageDiagnostic(IG_FIXTURE.code, slide(9), [body])).toMatchObject({
      carouselPosition: null,
      carouselFirstSlide: null,
    });
  });
  test('two qualifying objects of the same post stay a mismatch for a non-first slide', async () => {
    const bodies = [{ data: { items: [post()] } }, { media: post() }];
    const fields = compareSources(await record(), slide(2), bodies);
    expect(fields.image.agrees).toBe(false);
    expect(() => automaticCanaryCheck(check(fields))).toThrowError(
      expect.objectContaining({ code: 'CANARY_MISMATCH' }),
    );
    expect(imageDiagnostic(IG_FIXTURE.code, slide(2), bodies)).toMatchObject({
      carouselPosition: null,
      qualifyingObjects: 2,
    });
  });
  test('the same address in two carousel items stays a mismatch', async () => {
    const twice = post({ carousel_media: [item(1), item(2), item(2)] });
    const fields = compareSources(await record(), slide(2), [
      { data: { items: [twice] } },
    ]);
    expect(fields.image.agrees).toBe(false);
  });
  test('another post code is not a qualifying object', async () => {
    const other = post({ code: 'GeneratedOther' });
    const fields = compareSources(await record(), slide(2), [
      { data: { items: [other] } },
    ]);
    expect(fields.image).toMatchObject({ found: false, agrees: false });
  });
  test('a non-carousel post is unchanged and records no position', async () => {
    const single = post({
      carousel_media: undefined,
      image_versions2: item(1).image_versions2,
    });
    delete (single as Record<string, unknown>).carousel_media;
    const body = { data: { items: [single] } };
    const shown = compareSources(await record(), slide(1), [body]);
    expect(shown.image.agrees).toBe(true);
    expect(compareSources(await record(), slide(2), [body]).image.agrees).toBe(
      false,
    );
    expect(imageDiagnostic(IG_FIXTURE.code, slide(1), [body])).toMatchObject({
      carouselPosition: null,
      carouselFirstSlide: null,
      matchingLists: 1,
    });
  });
  test('the first slide agrees as before and records position 1', async () => {
    const body = { data: { items: [post()] } };
    expect(compareSources(await record(), slide(1), [body]).image.agrees).toBe(
      true,
    );
    expect(imageDiagnostic(IG_FIXTURE.code, slide(1), [body])).toMatchObject({
      carouselPosition: 1,
      carouselFirstSlide: true,
      matchingLists: 1,
    });
  });
});

test.each(IMAGE_CASES)(
  'IG-IMAGE current $name records exact image acceptance without changing its rule',
  async (entry) => {
    const { items } = await instagramFixture();
    const item = items[0]!;
    const shape = imageCase(
      entry.name,
      item,
      'https://generated.cdninstagram.com',
    );
    const record = instagramContractRecord(item);
    record.post.code = IG_FIXTURE.code;
    record.post.createdAt = IG_FIXTURE.postAt;
    record.post.caption = IG_FIXTURE.caption;
    const fields = compareSources(
      record,
      entry.captured ? shape.displayed : null,
      [shape.body],
    );
    expect(
      fields.owner.agrees && fields.time.agrees && fields.caption.agrees,
    ).toBe(true);
    expect(fields.image.agrees).toBe(entry.agrees);
    expect(fields.image.paths).toHaveLength(entry.paths);
    const check = {
      confirmed: true,
      fields,
      ownerShown: true,
      timeShown: true,
      imageStored: entry.captured,
      screenshotStored: true,
    };
    if (entry.agrees) expect(() => automaticCanaryCheck(check)).not.toThrow();
    else
      expect(() => automaticCanaryCheck(check)).toThrowError(
        expect.objectContaining({
          code: !entry.captured
            ? 'CANARY_CHECK_FAILED'
            : !fields.image.found
              ? 'CANARY_NO_SECOND_SOURCE'
              : 'CANARY_MISMATCH',
        }),
      );
    if (entry.name === 'extra-rendition-common-url') {
      expect(shape.body.data.items[0]!.image_versions2).toMatchObject({
        candidates: [{ url: shape.first }, { url: shape.low }],
      });
      expect(shape.body.media!.image_versions2).toMatchObject({
        candidates: [{ url: shape.first }],
      });
    }
  },
);
