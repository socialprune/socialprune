import type { EngineMediaRequest, EngineMediaReply } from 'socialprune/engine';
import {
  EngineMediaRequestSchema,
  EngineMediaReplySchema,
} from 'socialprune/engine';
import { DESKTOP_POLICY, isAppUrl } from './policy.ts';

const headers = {
  'Content-Security-Policy': DESKTOP_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
export function mediaTarget(
  url: string,
): Extract<EngineMediaRequest, { type: 'open' }>['target'] | null {
  if (!isAppUrl(url)) return null;
  // Do not decode or normalize an untrusted route into a file capability.
  const match =
    /^app:\/\/socialprune(\/originals\/(\d{1,40})\/([^/?#]+)|\/context\/instagram\/([A-Za-z0-9_-]{1,64})\/([^/?#]+))$/.exec(
      url,
    );
  if (!match) return null;
  const target = match[2]
    ? { kind: 'original', id: match[2], file: match[3] }
    : { kind: 'instagram', id: match[4], file: match[5] };
  const parsed = EngineMediaRequestSchema.safeParse({
    type: 'open',
    target,
    method: 'GET',
  });
  return parsed.success && parsed.data.type === 'open'
    ? parsed.data.target
    : null;
}

/** No disk access in main. Only private, schema-checked engine bytes. */
export async function mediaResponse(
  request: Request,
  send: (request: EngineMediaRequest) => Promise<EngineMediaReply>,
): Promise<Response> {
  const target = mediaTarget(request.url);
  const site = request.headers.get('sec-fetch-site');
  if (
    !target ||
    !['GET', 'HEAD'].includes(request.method) ||
    (site !== null && site !== 'same-origin') ||
    (request.referrer &&
      request.referrer !== 'about:client' &&
      !isAppUrl(request.referrer))
  )
    return new Response(null, { status: 404, headers });
  const reply = EngineMediaReplySchema.parse(
    await send({
      type: 'open',
      target,
      method: request.method as 'GET' | 'HEAD',
      ...(request.headers.has('range')
        ? { range: request.headers.get('range')! }
        : {}),
      ifRange: request.headers.has('if-range'),
    }),
  );
  if (reply.type !== 'opened')
    return new Response(null, { status: 404, headers });
  const token = reply.token;
  if (!token)
    return new Response(null, {
      status: reply.status,
      headers: { ...headers, ...reply.headers },
    });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    request.signal.removeEventListener('abort', abort);
    await send({ type: 'close', token });
  };
  const abort = () => {
    void close().catch(() => undefined);
  };
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) {
    await close();
    return new Response(null, { status: 404, headers });
  }
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (closed) {
            controller.close();
            return;
          }
          const value = EngineMediaReplySchema.parse(
            await send({ type: 'read', token }),
          );
          if (value.type !== 'chunk') throw new Error('MEDIA_READ_FAILED');
          if (closed) {
            controller.close();
            return;
          }
          controller.enqueue(value.bytes);
          if (value.done) {
            await close();
            controller.close();
          }
        } catch (error) {
          await close();
          controller.error(error);
        }
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: reply.status,
    headers: { ...headers, ...reply.headers },
  });
}
