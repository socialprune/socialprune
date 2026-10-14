import { expect, test } from 'vitest';
import type { OriginalMedia } from '@socialprune/core';
import { mergeFillMedia } from './media.ts';

const entry = (
  n: number,
  kind: OriginalMedia['kind'],
  status: OriginalMedia['status'],
): OriginalMedia => ({
  n,
  kind,
  status,
  source: 'anonymous',
  url:
    kind === 'photo'
      ? 'https://pbs.twimg.com/generated-old.jpg'
      : 'https://video.twimg.com/generated-old.mp4',
  file: status === 'stored' ? `${n}.${kind === 'photo' ? 'jpg' : 'mp4'}` : null,
  poster: null,
  bytes: status === 'stored' ? 12 : null,
  durationMs: null,
  bitrateLabel: null,
  altText: null,
});

test('a gated pass retains every stored entry exactly, including absent and changed-kind slots, and blocks all other media', () => {
  const old = [
    entry(1, 'video', 'stored'),
    entry(2, 'photo', 'stored'),
    entry(4, 'gif', 'stored'),
  ];
  old[0]!.poster = '1-poster.jpg';
  const current = [
    entry(1, 'video', 'not-stored'),
    entry(2, 'video', 'not-stored'),
    entry(3, 'photo', 'failed'),
  ];
  const merged = mergeFillMedia(current, old, true);
  expect(merged).toEqual([
    old[0],
    old[1],
    {
      ...current[2],
      status: 'not-stored',
      url: null,
      file: null,
      poster: null,
      bytes: null,
    },
    old[2],
  ]);
  expect(old[0]?.poster).toBe('1-poster.jpg');
  expect(current[2]?.url).toBe('https://pbs.twimg.com/generated-old.jpg');
});

test('ungated media reuse still requires the same slot, kind and URL', () => {
  const old = [entry(1, 'video', 'stored'), entry(2, 'photo', 'stored')];
  const current = [
    entry(1, 'video', 'not-stored'),
    entry(2, 'photo', 'failed'),
  ];
  current[1]!.url = 'https://pbs.twimg.com/generated-new.jpg';
  expect(mergeFillMedia(current, old, false)).toEqual([
    { ...current[0], status: 'stored', file: '1.mp4', poster: null, bytes: 12 },
    current[1],
  ]);
});

test('an earlier stored poster survives a gated pass even when its video was never stored', () => {
  const old = entry(2, 'video', 'no-variant');
  old.poster = '2-poster.jpg';
  const result = mergeFillMedia([], [old], true);
  expect(result).toEqual([
    { ...old, status: 'not-stored', url: null, file: null, bytes: null },
  ]);
  expect(result[0]?.poster).toBe('2-poster.jpg');
});
