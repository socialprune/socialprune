import { test, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadMedia,
  chooseVariants,
  productionMedia,
  mediaURL,
} from './video.ts';
import { cleanupParts } from './media.ts';
import { storeOriginalMedia } from './store-media.ts';
import { SyndicationClient } from './syndication.ts';
import { migrateOriginal } from '@socialprune/core';
const bytes = Uint8Array.from([
  0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
]);
test.each([
  'stored',
  'too-large',
  'refused',
  'run-cap',
  'failed-content',
  'failed-signature',
  '429',
  'disk-low',
  'idle-stall',
  'header-stall',
  'redirect',
] as const)(
  'streamed media fixture %s proves limits signatures anonymity and atomic file boundary',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'socialprune-video-')),
      budget = {
        videoBytes: 32,
        runBytes: 64,
        used: mode === 'run-cap' ? 64 : 0,
        lastStart: 0,
        failures: 0,
      };
    let called = 0,
      headers: RequestInit | undefined;
    const deps = {
      ...productionMedia,
      free: () =>
        Promise.resolve(mode === 'disk-low' ? 4 * 1024 ** 3 : 10 * 1024 ** 3),
      now: () => 10000,
      sleep: async () => {},
      idleMs: 20,
      headerMs: 20,
      async fetch(_url: unknown, options?: RequestInit) {
        await Promise.resolve();
        called++;
        headers = options;
        if (mode === 'header-stall')
          return new Promise<Response>((_resolve, reject) =>
            options?.signal?.addEventListener('abort', () =>
              reject(new Error('Header stalled')),
            ),
          );
        if (mode === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://example.org/decoy' },
          });
        if (mode === 'idle-stall')
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                options?.signal?.addEventListener('abort', () =>
                  controller.error(new Error('idle timeout')),
                );
              },
            }),
            {
              headers: { 'Content-Type': 'video/mp4', 'Content-Length': '16' },
            },
          );
        return new Response(
          mode === 'failed-signature' ? new Uint8Array(16) : bytes,
          {
            status: mode === 'refused' ? 403 : mode === '429' ? 429 : 200,
            headers: {
              'Content-Type':
                mode === 'failed-content' ? 'text/plain' : 'video/mp4',
              'Content-Length': mode === 'too-large' ? '100' : '16',
            },
          },
        );
      },
    };
    try {
      const action = downloadMedia(
        new URL('https://video.twimg.com/generated.mp4'),
        { workspace: directory, id: '101', n: 1 },
        budget,
        new AbortController().signal,
        deps,
      );
      if (['429', 'disk-low'].includes(mode)) {
        await expect(action).rejects.toMatchObject({
          code: mode === '429' ? 'MEDIA_RATE_LIMIT' : 'DISK_LOW',
        });
      } else {
        const result = await action;
        expect(result.status).toBe(
          mode.startsWith('failed') ||
            ['idle-stall', 'header-stall', 'redirect'].includes(mode)
            ? 'failed'
            : mode,
        );
        if (mode === 'stored') {
          expect(
            await readFile(join(directory, 'originals', '101', '1.mp4')),
          ).toEqual(Buffer.from(bytes));
          expect(await readdir(join(directory, 'originals', '101'))).toEqual([
            '1.mp4',
          ]);
        }
        if (mode === 'idle-stall' || mode === 'failed-signature') {
          await cleanupParts(directory);
          expect(await readdir(join(directory, 'originals', '101'))).toEqual(
            [],
          );
        }
      }
      if (called) {
        expect(headers).toMatchObject({
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: { 'User-Agent': 'SocialPrune/0.0.0' },
        });
        expect(JSON.stringify(headers)).not.toMatch(/cookie|referer/i);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test('MP4 variant choice keeps descending labels and never fetches an HLS playlist', () => {
  expect(
    chooseVariants([
      {
        content_type: 'application/x-mpegURL',
        url: 'https://video.twimg.com/x.m3u8',
      },
      {
        content_type: 'video/mp4',
        bitrate: 288000,
        url: 'https://video.twimg.com/low.mp4',
      },
      {
        content_type: 'video/mp4',
        bitrate: 2176000,
        url: 'https://video.twimg.com/high.mp4',
      },
    ]).map((value) => value.bitrate),
  ).toEqual([2176000, 288000]);
});
test('media host redirects credentials ports and lookalike origins fail closed before any download', () => {
  expect(
    mediaURL('https://video.twimg.com/generated.mp4', 'video').origin,
  ).toBe('https://video.twimg.com');
  for (const value of [
    'http://video.twimg.com/generated.mp4',
    'https://video.twimg.com.example.org/generated.mp4',
    'https://example.org/generated.mp4',
    'https://person:secret@video.twimg.com/generated.mp4',
    'https://video.twimg.com:4430/generated.mp4',
    'https://pbs.twimg.com/generated.mp4',
  ])
    expect(() => mediaURL(value, 'video')).toThrow();
});
test('five consecutive video failures stop and the caller never receives a fabricated stored file', async () => {
  const directory = await mkdtemp(
      join(tmpdir(), 'socialprune-video-failures-'),
    ),
    budget = {
      videoBytes: 32,
      runBytes: 64,
      used: 0,
      lastStart: 0,
      failures: 0,
    };
  const deps = {
    ...productionMedia,
    free: () => Promise.resolve(10 * 1024 ** 3),
    now: () => 10000,
    sleep: () => Promise.resolve(),
    fetch: () =>
      Promise.resolve(
        new Response(bytes, {
          headers: { 'Content-Type': 'text/html', 'Content-Length': '16' },
        }),
      ),
  };
  try {
    for (let i = 0; i < 4; i++)
      expect(
        (
          await downloadMedia(
            new URL('https://video.twimg.com/generated.mp4'),
            { workspace: directory, id: '101', n: 1 },
            budget,
            new AbortController().signal,
            deps,
          )
        ).status,
      ).toBe('failed');
    await expect(
      downloadMedia(
        new URL('https://video.twimg.com/generated.mp4'),
        { workspace: directory, id: '101', n: 1 },
        budget,
        new AbortController().signal,
        deps,
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('fallback retries only descending anonymous MP4 variants, preserves a refused record and still stores its poster', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-video-variants-'),
  );
  const urls: string[] = [],
    posters: string[] = [];
  const variants = [
    {
      content_type: 'video/mp4',
      bitrate: 2176000,
      url: 'https://video.twimg.com/high.mp4',
    },
    {
      content_type: 'video/mp4',
      bitrate: 288000,
      url: 'https://video.twimg.com/low.mp4',
    },
  ];
  const make = (id: string) =>
    migrateOriginal({
      id,
      status: 'fetched',
      fetchedAt: '2026-10-12T00:00:00.000Z',
      text: 'Generated',
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: {
        mediaDetails: [
          {
            type: 'video',
            media_url_https: 'https://pbs.twimg.com/generated.png',
            video_info: { variants },
          },
        ],
      },
      textCompleteness: 'unknown',
      video: 'not-stored',
    });
  const client = new SyndicationClient();
  client.photo = (url) => {
    posters.push(url);
    return Promise.resolve({
      bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      extension: 'png',
    });
  };
  const deps = {
    ...productionMedia,
    free: () => Promise.resolve(10 * 1024 ** 3),
    now: () => 10000,
    sleep: () => Promise.resolve(),
    fetch: (url: unknown) => {
      const value = String(url);
      urls.push(value);
      return Promise.resolve(
        new Response(bytes, {
          status: value.includes('refused') ? 403 : 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': value.includes('high') ? '100' : '16',
          },
        }),
      );
    },
  };
  const budget = {
    videoBytes: 32,
    runBytes: 64,
    used: 0,
    lastStart: 0,
    failures: 0,
  };
  try {
    const original = make('101');
    await storeOriginalMedia(
      directory,
      original,
      client,
      budget,
      new AbortController().signal,
      deps,
    );
    expect(urls).toEqual([
      'https://video.twimg.com/high.mp4',
      'https://video.twimg.com/low.mp4',
    ]);
    expect(original.media[0]).toMatchObject({
      status: 'stored',
      file: '1.mp4',
      poster: '1-poster.png',
      bitrateLabel: 288000,
    });
    expect(await readdir(join(directory, 'originals', '101'))).toEqual([
      '1-poster.png',
      '1.mp4',
    ]);
    const refused = make('102');
    refused.raw!.mediaDetails = [
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/generated.png',
        video_info: {
          variants: [
            {
              content_type: 'video/mp4',
              url: 'https://video.twimg.com/refused.mp4',
            },
          ],
        },
      },
    ];
    await storeOriginalMedia(
      directory,
      refused,
      client,
      { ...budget, used: 0 },
      new AbortController().signal,
      deps,
    );
    expect(refused.media[0]).toMatchObject({
      status: 'refused',
      file: null,
      poster: '1-poster.png',
    });
    expect(urls.at(-1)).toBe('https://video.twimg.com/refused.mp4');
    expect(posters).toHaveLength(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
