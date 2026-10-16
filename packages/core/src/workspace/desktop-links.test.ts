import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { platformPostUrl } from '@socialprune/core/workspace/desktop-links';
import { DesktopLinkSchema, DesktopRequestSchema } from './desktop-protocol.ts';

const fixtureRoot = new URL('../../../../fixtures/synthetic/', import.meta.url);
const expectedSchema = z.object({
  items: z.array(z.object({ url: z.string().nullable() })),
});

test('post URLs from every X expected fixture and the demo pass the bridge unchanged', async () => {
  const variants = await readdir(new URL('x/', fixtureRoot), {
    withFileTypes: true,
  });
  const files = variants
    .filter((entry) => entry.isDirectory())
    .map((entry) => `x/${entry.name}/expected.json`);
  files.push('demo/x/expected.json');
  let checked = 0;
  for (const file of files) {
    const expected = expectedSchema.parse(
      JSON.parse(await readFile(new URL(file, fixtureRoot), 'utf8')),
    );
    for (const item of expected.items) {
      if (item.url === null) continue;
      const link = { kind: 'platform-post', url: item.url };
      expect(platformPostUrl(item.url), file).toBe(item.url);
      expect(
        DesktopRequestSchema.parse({
          requestId: 'generated-post-link',
          type: 'openLink',
          link,
        }),
      ).toEqual({ requestId: 'generated-post-link', type: 'openLink', link });
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(300);
});

test('demo expanded status links are data, never executed, and fit the named-handle route', async () => {
  const source = await readFile(
    new URL('demo/x/twitter-2026-10-01-demox/data/tweets.js', fixtureRoot),
    'utf8',
  );
  const data: unknown = JSON.parse(
    source
      .slice(source.indexOf('=') + 1)
      .trim()
      .replace(/;$/, ''),
  );
  const urls: string[] = [];
  function collect(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (
          key === 'expanded_url' &&
          typeof entry === 'string' &&
          entry.startsWith('https://x.com/')
        )
          urls.push(entry);
        else collect(entry);
      }
    }
  }
  collect(data);
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) expect(platformPostUrl(url)).toBe(url);
});

test('the closed route set includes X status routes and stored Instagram post and reel routes', () => {
  // Instagram exports contain no post URL. These generated routes follow the
  // stored context kind/code fields and InstagramPost.tsx, not an export claim.
  for (const url of [
    'https://x.com/i/web/status/9007199254740993',
    'https://x.com/generated_name/status/123',
    'https://twitter.com/generated_name/status/123',
    'https://twitter.com/i/web/status/123',
    'https://www.instagram.com/p/Generated_1-/',
    'https://www.instagram.com/reel/Generated_2-/',
    `https://www.instagram.com/p/${'a'.repeat(64)}/`,
  ]) {
    expect(platformPostUrl(url)).toBe(url);
    expect(DesktopLinkSchema.parse({ kind: 'platform-post', url })).toEqual({
      kind: 'platform-post',
      url,
    });
  }
  expect(import.meta.resolve('@socialprune/core/workspace/desktop-links')).toBe(
    new URL('./desktop-links.ts', import.meta.url).href,
  );
});

test.each([
  'https://x.com/generated_name',
  'https://www.instagram.com/p/Generated/?utm_source=generated',
  'http://x.com/generated/status/123',
  'http://www.instagram.com/p/Generated/',
])('post link red control: rejects %s', (url) => {
  expect(platformPostUrl(url), url).toBeNull();
  expect(
    DesktopRequestSchema.safeParse({
      requestId: 'generated-post-link',
      type: 'openLink',
      link: { kind: 'platform-post', url },
    }).success,
    url,
  ).toBe(false);
});

test('post addresses reject every non-post destination, extra syntax and parser normalization trick', () => {
  for (const url of [
    'https://x.com/',
    'https://x.com/search',
    'https://x.com/settings/account',
    'https://twitter.com/generated',
    'https://www.instagram.com/generated/',
    'https://www.instagram.com/explore/',
    'https://instagram.com/p/Generated/',
    'https://www.x.com/generated/status/123',
    'https://x.com/i/status/123',
    'https://x.com/generated/status/abc',
    'https://x.com/generated/status/123/',
    'https://x.com/generated/status/123/photo/1',
    'https://x.com/generated/status/123/video/1',
    'https://x.com/generated/status/123?ref=generated',
    'https://x.com/generated/status/123#generated',
    'https://x.com/generated/status/123?',
    'https://x.com/generated/status/123#',
    'https://www.instagram.com/p/Generated',
    'https://www.instagram.com/tv/Generated/',
    'https://www.instagram.com/reels/Generated/',
    'https://www.instagram.com/p/Generated/c/123/',
    'https://www.instagram.com/reel/Generated/#generated',
    `https://www.instagram.com/p/${'a'.repeat(65)}/`,
    'https://www.instagram.com/p/Generated%2D/',
    'https://user:password@x.com/generated/status/123',
    'https://x.com:443/generated/status/123',
    'https://x.com:444/generated/status/123',
    'https://x.com.evil.invalid/generated/status/123',
    'https://www.instagram.com.evil.invalid/p/Generated/',
    'https://help.x.com/en/generated',
    'https://github.com/socialprune/socialprune/issues/new',
    'https://x.com/generated/../generated/status/123',
    'https://x.com/%67enerated/status/123',
    ' https://x.com/generated/status/123',
    'https://x.com/generated/status/123\n',
    'https://x.com/generated\\status\\123',
    '//x.com/generated/status/123',
    ['javascript', 'alert(1)'].join(':'),
    'file:///generated',
    '',
  ]) {
    expect(platformPostUrl(url), url).toBeNull();
    expect(
      DesktopLinkSchema.safeParse({ kind: 'platform-post', url }).success,
      url,
    ).toBe(false);
  }
  expect(
    DesktopLinkSchema.safeParse({
      kind: 'platform-post',
      url: 'https://x.com/generated/status/123',
      extra: true,
    }).success,
  ).toBe(false);
});
