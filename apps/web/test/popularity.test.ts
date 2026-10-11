import { describe, expect, it } from 'vitest';
import { popularIds, popularityThreshold } from '@socialprune/core';
import { feedExpected, feedFixture } from './feed-fixture.ts';

describe('own-account top-decile popularity', () => {
  it('matches fixture cutoff eight and excludes high-like reposts and Instagram', () => {
    const data = feedFixture();
    expect(popularityThreshold(data.items, feedExpected.account)).toBe(
      feedExpected.threshold,
    );
    expect([...popularIds(data.items, feedExpected.account, 8)].sort()).toEqual(
      [...feedExpected.popular].sort(),
    );
    expect(popularityThreshold(data.items, 'synthetic-comment')).toBeNull();
    expect([...popularIds(data.items, 'synthetic-comment', 3)]).toEqual([]);
  });
  it('applies minimum three, includes threshold ties and ignores unknown likes', () => {
    const data = feedFixture().items.slice(0, 20);
    data.forEach((item) => {
      item.engagement.likes = 0;
    });
    data[0]!.engagement.likes = 3;
    data[1]!.engagement.likes = 3;
    data[2]!.engagement.likes = null;
    expect(popularityThreshold(data, feedExpected.account)).toBe(3);
    expect([...popularIds(data, feedExpected.account, 3)]).toEqual([
      'x:feed-0000',
      'x:feed-0001',
    ]);
    data[0]!.engagement.likes = 2;
    data[1]!.engagement.likes = 1;
    expect(popularityThreshold(data, feedExpected.account)).toBe(3);
    expect(popularIds(data, feedExpected.account, 3).size).toBe(0);
  });
  it('rounds top ten percent upward on eleven known own entries and never mixes accounts', () => {
    const own = feedFixture().items.slice(0, 11);
    own.forEach((item, index) => {
      item.engagement.likes = index;
    });
    const foreign = structuredClone(own[0]!);
    foreign.id = 'x:foreign';
    foreign.account.key = 'other';
    foreign.engagement.likes = 99999;
    expect(popularityThreshold([...own, foreign], feedExpected.account)).toBe(
      9,
    );
    expect(popularityThreshold([], feedExpected.account)).toBeNull();
  });
});
