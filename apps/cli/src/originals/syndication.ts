import { z } from 'zod';
import { OriginalIdSchema, migrateOriginal } from '@socialprune/core';
import type { Original } from '@socialprune/core';

const productionOrigin = 'https://cdn.syndication.twimg.com';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const SYNDICATION_ORIGIN = productionOrigin;

/** Reused from react-tweet 3.3.1, MIT; see THIRD_PARTY_NOTICES. */
export function syndicationToken(id: string): string {
  OriginalIdSchema.parse(id);
  return ((Number(id) / 1e15) * Math.PI)
    .toString(6 ** 2)
    .replace(/(0+|\.)/g, '');
}

export async function boundedBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maximum) {
    await response.body?.cancel();
    throw new Error('RESPONSE_TOO_LARGE');
  }
  if (!response.body) return new Uint8Array();
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  let length = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) throw new Error('RESPONSE_TOO_LARGE');
      parts.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

const responseSchema = z.object({
  text: z.string().max(1_000_000),
  user: z.object({
    name: z.string().max(4096),
    screen_name: z.string().max(512),
  }),
  photos: z
    .array(z.object({ url: z.string().max(4096) }))
    .max(4)
    .optional(),
  quoted_tweet: z.object({ id_str: OriginalIdSchema.optional() }).optional(),
  parent: z.object({ id_str: OriginalIdSchema.optional() }).optional(),
  in_reply_to_status_id_str: OriginalIdSchema.optional(),
  truncated: z.boolean().optional(),
  note_tweet: z.unknown().optional(),
  video: z.unknown().optional(),
});

export class SyndicationClient {
  private readonly origin: string;
  constructor(options: { baseUrl?: string } = {}) {
    const url = new URL(options.baseUrl ?? productionOrigin);
    // Injection is only for a disposable loopback server, never an arbitrary
    // endpoint or a runtime environment override carrying workspace references.
    if (
      url.origin !== productionOrigin &&
      !(url.protocol === 'http:' && url.hostname === '127.0.0.1')
    )
      throw new Error('INVALID_SYNDICATION_ORIGIN');
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('INVALID_SYNDICATION_ORIGIN');
    this.origin = url.origin;
  }
  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    return fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'User-Agent': 'SocialPrune/0.0.0' },
    });
  }
  async fetchOriginal(
    id: string,
    fetchedAt: string,
    signal: AbortSignal,
  ): Promise<Original> {
    const url = new URL('/tweet-result', this.origin);
    url.searchParams.set('id', OriginalIdSchema.parse(id));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('token', syndicationToken(id));
    const response = await this.request(url, signal);
    const empty = {
      id,
      fetchedAt,
      status: 'not-found',
      text: null,
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: null,
      textCompleteness: 'unknown',
      video: null,
    };
    if (response.status === 404) {
      await response.body?.cancel();
      return migrateOriginal(empty);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('SYNDICATION_HTTP');
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw new Error('SYNDICATION_FORMAT');
    }
    const raw = z
      .record(z.string(), z.json())
      .parse(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            await boundedBytes(response, MAX_JSON_BYTES),
          ),
        ),
      );
    if (!Object.keys(raw).length) return migrateOriginal({ ...empty, raw });
    if (raw.__typename === 'TweetTombstone')
      return migrateOriginal({ ...empty, status: 'tombstone', raw });
    const data = responseSchema.parse(raw);
    return migrateOriginal({
      ...empty,
      status: 'fetched',
      text: data.text,
      authorName: data.user.name,
      authorHandle: data.user.screen_name,
      photos: (data.photos ?? []).map(({ url }) => ({
        url,
        file: null,
        status: 'failed',
      })),
      quotedId: data.quoted_tweet?.id_str ?? null,
      parentId: data.parent?.id_str ?? data.in_reply_to_status_id_str ?? null,
      raw,
      textCompleteness:
        data.truncated || Object.hasOwn(raw, 'note_tweet')
          ? 'truncated'
          : 'unknown',
      video: data.video ? 'not-stored' : null,
    });
  }
  async photo(
    url: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; extension: string }> {
    const target = new URL(url);
    const allowed =
      this.origin === productionOrigin
        ? target.protocol === 'https:' &&
          target.hostname === 'pbs.twimg.com' &&
          !target.port
        : target.origin === this.origin;
    if (!allowed || target.username || target.password)
      throw new Error('PHOTO_ORIGIN');
    const response = await this.request(target, signal);
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw Object.assign(new Error('MEDIA_RATE_LIMIT'), {
          code: 'MEDIA_RATE_LIMIT',
        });
      throw new Error('PHOTO_HTTP');
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim();
    const bytes = await boundedBytes(response, MAX_PHOTO_BYTES);
    const extension = imageExtension(bytes, contentType);
    if (!extension) throw new Error('PHOTO_FORMAT');
    return { bytes, extension };
  }
}

/** Only raster files with matching MIME and file signatures can be served. */
export function imageExtension(
  bytes: Uint8Array,
  contentType: string | undefined,
): string | null {
  if (
    contentType === 'image/png' &&
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return 'png';
  if (
    contentType === 'image/jpeg' &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'jpg';
  if (
    contentType === 'image/gif' &&
    ['GIF87a', 'GIF89a'].includes(
      Buffer.from(bytes.subarray(0, 6)).toString('ascii'),
    )
  )
    return 'gif';
  if (
    contentType === 'image/webp' &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  )
    return 'webp';
  return null;
}
