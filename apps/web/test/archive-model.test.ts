import { describe, expect, it } from 'vitest';
import type { Item } from '@socialprune/core';
import { joinThreads, recap } from '../src/archive/model.ts';
import { personExpected, personFixture } from './person-fixture.ts';

const item = (
  id: string,
  replyToId: string | null = null,
  replyToHandle: string | null = null,
): Item => ({
  id: `x:${id}`,
  platform: 'x',
  account: { key: 'x:generated', handle: 'generated_fern' },
  kind: replyToId ? 'reply' : 'post',
  text: 'lol LOL lollipop',
  createdAt: `2020-01-0${id}T12:00:00.000Z`,
  engagement: { likes: Number(id), reposts: null },
  reference: {
    replyToId,
    replyToHandle,
    repostOfHandle: null,
    quotedId: null,
    ownerHandle: null,
  },
  mediaCount: 0,
  url: null,
  provenance: { archive: 'synthetic', file: 'synthetic', index: 0 },
});
const entry = (value: Item) => ({ item: value, outcome: 'unknown' as const });

describe('private archive groups and count-only recap', () => {
  it('matches the generated fixture thread, separate foreign reply and declared recap oracle', () => {
    const entries = personFixture()
      .items.filter((item) => item.account.key === personExpected.accountKey)
      .map(entry);
    expect(
      joinThreads(entries).map((group) => group.map(({ item }) => item.id)),
    ).toEqual(personExpected.groupsNewestFirst);
    expect(
      recap(entries, new Date('2026-10-10T12:00:00Z'), 'Europe/Berlin'),
    ).toEqual(personExpected.recapAt20261010);
  });
  it('joins own raw or prefixed reply chains but not a foreign handle on a colliding ID', () => {
    const entries = [
      entry(item('1')),
      entry(item('2', '1', 'generated_fern')),
      entry(item('3', 'x:2', 'generated_fern')),
      entry(item('4', '1', 'different_fern')),
    ];
    expect(
      joinThreads(entries).map((group) => group.map(({ item }) => item.id)),
    ).toEqual([['x:4'], ['x:1', 'x:2', 'x:3']]);
  });
  it('does not join accounts, missing parents or cycles', () => {
    const foreign = item('2', '1', 'generated_fern');
    foreign.account = { key: 'x:other', handle: 'generated_fern' };
    const entries = [
      entry(item('1')),
      entry(foreign),
      entry(item('3', 'missing')),
      entry(item('4', '5')),
      entry(item('5', '4')),
    ];
    expect(joinThreads(entries).every((group) => group.length === 1)).toBe(
      true,
    );
  });
  it('keeps every thread item including a person-recorded deletion', () => {
    const entries = [
      entry(item('1')),
      {
        item: item('2', '1', 'generated_fern'),
        outcome: 'deleted-by-user' as const,
      },
    ];
    expect(joinThreads(entries)[0]).toHaveLength(2);
    expect(joinThreads(entries)[0]![1]!.outcome).toBe('deleted-by-user');
  });
  it('uses anniversary age, known likes, local years and whole words without returning item text', () => {
    const first = item('1');
    first.createdAt = '2018-10-11T00:30:00.000Z';
    first.engagement.likes = null;
    const next = item('2');
    next.createdAt = '2020-01-01T00:30:00.000Z';
    next.engagement.likes = 12;
    const last = item('3');
    last.createdAt = '2020-01-02T00:30:00.000Z';
    last.text = 'no short word';
    expect(
      recap(
        [entry(first), entry(next), entry(last)],
        new Date('2026-10-10T12:00:00Z'),
      ),
    ).toMatchObject({
      age: 7,
      year: '2020',
      activeCount: 2,
      likes: 12,
      lols: 4,
    });
    expect(recap([entry(next)], new Date(), 'America/Los_Angeles').year).toBe(
      '2019',
    );
    expect(recap([], new Date())).toMatchObject({
      oldest: null,
      likes: null,
      year: null,
      lols: 0,
    });
  });
});
