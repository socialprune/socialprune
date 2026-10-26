import { describe, expect, it } from 'vitest';
import { sampleItem } from '../testing.ts';
import { isPopular, popularIds, popularityThreshold } from './popular.ts';

function fixture() {
  const seed = sampleItem();
  // Generated input and literal oracle are independent of percentile code.
  const likes = [...Array<number>(16).fill(0), 3, 5, 8, 13];
  return likes.map((count, index) => ({
    ...structuredClone(seed),
    id: `x:popular-${index}`,
    platform: 'x' as const,
    kind: 'post' as const,
    account: { key: 'x:generated', handle: 'generated' },
    engagement: { likes: count, reposts: 0 },
  }));
}

describe('canonical own-account popularity', () => {
  it('uses fixture top decile eight, not an account maximum or average', () => {
    const items = fixture();
    expect(popularityThreshold(items, 'x:generated')).toBe(8);
    expect([...popularIds(items, 'x:generated')]).toEqual([
      'x:popular-18',
      'x:popular-19',
    ]);
  });
  it('excludes high-like reposts, other accounts, Instagram and unknown counts', () => {
    const items = fixture();
    const extra = (id: string) => ({
      ...structuredClone(items[0]!),
      id,
      engagement: { likes: 9999, reposts: 0 },
    });
    const repost = { ...extra('x:repost'), kind: 'repost' as const };
    const other = {
      ...extra('x:other'),
      account: { key: 'x:other', handle: 'other' },
    };
    const instagram = {
      ...extra('instagram:comment'),
      platform: 'instagram' as const,
      account: { key: 'instagram:generated', handle: 'generated' },
      kind: 'comment' as const,
    };
    const unknown = {
      ...extra('x:unknown'),
      engagement: { likes: null, reposts: null },
    };
    const all = [...items, repost, other, instagram, unknown];
    expect(popularityThreshold(all, 'x:generated')).toBe(8);
    expect([...popularIds(all, 'x:generated')]).toEqual([
      'x:popular-18',
      'x:popular-19',
    ]);
    expect(isPopular(instagram, 'x:generated', 3)).toBe(false);
    expect(isPopular(unknown, 'x:generated', 3)).toBe(false);
  });
  it('includes equal-cutoff ties and enforces three for short accounts', () => {
    const items = fixture().slice(0, 3);
    items[0]!.engagement.likes = 3;
    items[1]!.engagement.likes = 3;
    items[2]!.engagement.likes = 1;
    expect(popularityThreshold(items, 'x:generated')).toBe(3);
    expect([...popularIds(items, 'x:generated')]).toEqual([
      'x:popular-0',
      'x:popular-1',
    ]);
    items[0]!.engagement.likes = 2;
    items[1]!.engagement.likes = 1;
    expect(popularityThreshold(items, 'x:generated')).toBe(3);
    expect(popularIds(items, 'x:generated').size).toBe(0);
    expect(popularityThreshold([], 'x:generated')).toBeNull();
  });
  it('ceil top ten percent ranks two of eleven entries', () => {
    const items = fixture().slice(0, 11);
    items.forEach((item, index) => {
      item.engagement.likes = index;
    });
    expect(popularityThreshold(items, 'x:generated')).toBe(9);
    expect([...popularIds(items, 'x:generated')]).toEqual([
      'x:popular-9',
      'x:popular-10',
    ]);
  });
  it('independent exclusion oracle catches a guardless planted implementation (LL-002)', () => {
    const item = {
      ...fixture()[0]!,
      platform: 'instagram' as const,
      kind: 'comment' as const,
      engagement: { likes: null, reposts: null },
    };
    const assertExcluded = (predicate: typeof isPopular) =>
      expect(predicate(item, 'x:generated', 3)).toBe(false);
    expect(() => assertExcluded(isPopular)).not.toThrow();
    expect(() => assertExcluded(() => true)).toThrow();
  });
});
