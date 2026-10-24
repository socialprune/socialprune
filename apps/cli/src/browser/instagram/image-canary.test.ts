import { expect, test } from 'vitest';
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

test('IG-IMAGE diagnostic counts qualifying focal objects and exact-url candidate lists without leaking addresses', async () => {
  const { items } = await instagramFixture();
  const shape = imageCase(
    'extra-rendition-common-url',
    items[0]!,
    'https://generated.cdninstagram.com',
  );
  const diagnostic = imageDiagnostic;
  expect(diagnostic(IG_FIXTURE.code, shape.first, [shape.body])).toEqual({
    qualifyingObjects: 2,
    matchingLists: 2,
    distinctListLengths: [1, 2],
    source: 'img-current-src',
  });
  expect(diagnostic(IG_FIXTURE.code, null, [shape.body])).toEqual({
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
    qualifyingObjects: 2,
    matchingLists: 1,
    distinctListLengths: [1],
    source: 'img-current-src',
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
