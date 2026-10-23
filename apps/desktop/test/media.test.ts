import { expect, test, vi } from 'vitest';
import { mediaTarget, mediaResponse } from '../src/main/media.ts';
import type { EngineMediaReply, EngineMediaRequest } from 'socialprune/engine';
test('app media routes reject traversal, queries, foreign origins and arbitrary files before dispatch', async () => {
  for (const url of [
    'app://socialprune/originals/1/1.png?path=private',
    'app://socialprune/originals/1/%31.png',
    'app://socialprune/originals/1/../1.png',
    'app://socialprune/originals/1/1.svg',
    'app://socialprune/context/instagram/Code/other.jpg',
    'app://other/originals/1/1.png',
    'file:///originals/1/1.png',
    'app://socialprune/originals/1/1.png#part',
    'app://socialprune/originals/1/..%2f1.png',
    'app://socialprune/context/instagram/../image.png',
    'app://socialprune/originals/1/1.png/extra',
  ])
    expect(mediaTarget(url), url).toBeNull();
  const send =
    vi.fn<(input: EngineMediaRequest) => Promise<EngineMediaReply>>();
  await expect(
    mediaResponse(
      new Request('app://socialprune/originals/1/1.png', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
      send,
    ),
  ).resolves.toHaveProperty('status', 404);
  expect(send).not.toHaveBeenCalled();
  for (const method of ['POST', 'PUT', 'DELETE'])
    expect(
      (
        await mediaResponse(
          new Request('app://socialprune/originals/1/1.png', { method }),
          send,
        )
      ).status,
    ).toBe(404);
  expect(
    (
      await mediaResponse(
        new Request('app://socialprune/originals/1/1.png', {
          referrer: 'https://generated.invalid/',
        }),
        send,
      )
    ).status,
  ).toBe(404);
  expect(send).not.toHaveBeenCalled();
});
test('main pulls bounded bytes and closes cancellation without fetch, file access or relaxing policy', async () => {
  const token = crypto.randomUUID();
  const send = vi
    .fn<(input: EngineMediaRequest) => Promise<EngineMediaReply>>()
    .mockResolvedValueOnce({
      type: 'opened',
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '3',
        'Content-Range': 'bytes 1-3/10',
        'Accept-Ranges': 'bytes',
      },
      token,
    })
    .mockResolvedValueOnce({
      type: 'chunk',
      bytes: Uint8Array.of(1, 2, 3),
      done: true,
    })
    .mockResolvedValue({ type: 'closed' });
  const response = await mediaResponse(
    new Request('app://socialprune/originals/1/1.mp4', {
      headers: { range: 'bytes=1-3' },
    }),
    send,
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-security-policy')).toContain(
    "connect-src 'none'",
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    Uint8Array.of(1, 2, 3),
  );
  expect(send.mock.calls).toEqual([
    [
      {
        type: 'open',
        target: { kind: 'original', id: '1', file: '1.mp4' },
        method: 'GET',
        range: 'bytes=1-3',
        ifRange: false,
      },
    ],
    [{ type: 'read', token }],
    [{ type: 'close', token }],
  ]);
  send
    .mockReset()
    .mockResolvedValueOnce({ type: 'opened', status: 200, headers: {}, token })
    .mockResolvedValue({ type: 'closed' });
  const cancelled = await mediaResponse(
    new Request('app://socialprune/originals/1/1.png'),
    send,
  );
  await cancelled.body!.cancel();
  expect(send).toHaveBeenLastCalledWith({ type: 'close', token });
  const abort = new AbortController();
  send
    .mockReset()
    .mockResolvedValueOnce({ type: 'opened', status: 200, headers: {}, token })
    .mockResolvedValue({ type: 'closed' });
  await mediaResponse(
    new Request('app://socialprune/originals/1/1.png', {
      signal: abort.signal,
    }),
    send,
  );
  abort.abort();
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith({ type: 'close', token }),
  );
});

test('renderer public bridge has no media or file capability; private schema rejects paths and oversized chunks', async () => {
  const { DesktopRequestSchema } = await import('../src/protocol.ts');
  const { HostCommandSchema, HostEventSchema } =
    await import('../src/host-protocol.ts');
  const id = crypto.randomUUID();
  expect(
    DesktopRequestSchema.safeParse({
      type: 'media',
      requestId: id,
      path: 'generated-private',
    }).success,
  ).toBe(false);
  expect(
    HostCommandSchema.safeParse({
      type: 'media',
      id,
      message: {
        type: 'open',
        target: { kind: 'original', id: '1', file: '1.png' },
        method: 'GET',
        path: 'generated-private',
      },
    }).success,
  ).toBe(false);
  expect(
    HostEventSchema.safeParse({
      type: 'media',
      id,
      reply: { type: 'chunk', bytes: new Uint8Array(262145), done: true },
    }).success,
  ).toBe(false);
});
