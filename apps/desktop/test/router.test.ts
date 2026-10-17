import { expect, test, vi } from 'vitest';
import { createRouter } from '../src/main/router.ts';
import type { SenderEvent, SenderIdentity } from '../src/main/router.ts';

const request = {
  requestId: '00000000-0000-4000-8000-000000000001',
  type: 'runView' as const,
};
export function identities() {
  const frame = {
    url: 'app://socialprune/desktop.html',
    processId: 7,
    routingId: 2,
    parent: null,
  };
  const owner: SenderIdentity = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  };
  const event: SenderEvent = {
    sender: owner,
    senderFrame: frame,
    processId: 7,
    frameId: 2,
  };
  return { frame, owner, event };
}

test('own live main frame and only the strict read shape reach dispatch', async () => {
  const { owner, event } = identities();
  const dispatch = vi.fn().mockResolvedValue({
    ...request,
    type: 'runView',
    view: { phase: 'idle', version: 0 },
  });
  const log = vi.fn();
  const route = createRouter(owner, dispatch, log);
  await expect(route(event, request)).resolves.toMatchObject({
    view: { phase: 'idle' },
  });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(request);
  for (const message of [
    null,
    {},
    { ...request, type: 'decide' },
    { ...request, path: 'generated-secret' },
    { ...request, requestId: 5 },
  ])
    await expect(route(event, message)).rejects.toThrow('BRIDGE_REJECTED');
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(log.mock.calls).toEqual(
    Array.from({ length: 5 }, () => ['MESSAGE_REJECTED']),
  );
});

test('hash routes retain the main-frame identity, but queries and other documents do not', async () => {
  const { owner, event, frame } = identities();
  const dispatch = vi.fn().mockResolvedValue({
    type: 'runView',
    requestId: request.requestId,
    view: { phase: 'idle', version: 0 },
  });
  const route = createRouter(owner, dispatch, vi.fn());
  frame.url += '#/review/list';
  await expect(route(event, request)).resolves.toMatchObject({
    type: 'runView',
  });
  frame.url = 'app://socialprune/desktop.html?foreign=1';
  await expect(route(event, request)).rejects.toThrow('BRIDGE_REJECTED');
  frame.url = 'app://socialprune/other.html';
  await expect(route(event, request)).rejects.toThrow('BRIDGE_REJECTED');
});

test('main checks reply identity, method, and run-view shape before returning it', async () => {
  const { owner, event } = identities();
  for (const reply of [
    {
      type: 'runView',
      requestId: 'other',
      view: { phase: 'idle', version: 0 },
    },
    { type: 'linkOpened', requestId: request.requestId },
    { type: 'runView', requestId: request.requestId, view: { phase: 'idle' } },
  ]) {
    await expect(
      createRouter(
        owner,
        () => Promise.resolve(reply as never),
        vi.fn(),
      )(event, request),
    ).rejects.toThrow();
  }
});

test.each([
  'other-contents',
  'other-frame',
  'subframe',
  'process',
  'routing',
  'navigated',
  'host-prefix',
  'dead-frame',
  'destroyed',
])(
  'forged %s sender is rejected without values or dispatch',
  async (variant) => {
    const { owner, event, frame } = identities();
    if (variant === 'other-contents') event.sender = { ...owner };
    if (variant === 'other-frame') event.senderFrame = { ...frame };
    if (variant === 'subframe') frame.parent = {} as never;
    if (variant === 'process') event.processId++;
    if (variant === 'routing') event.frameId++;
    if (variant === 'navigated') frame.url = 'https://generated.invalid/secret';
    if (variant === 'host-prefix')
      frame.url = 'app://socialprune.generated.invalid/index.html';
    if (variant === 'dead-frame') event.senderFrame = null;
    if (variant === 'destroyed') owner.isDestroyed = () => true;
    const dispatch = vi.fn().mockResolvedValue({
      requestId: request.requestId,
      type: 'runView',
      view: { phase: 'idle', version: 0 },
    });
    const log = vi.fn();
    await expect(
      createRouter(owner, dispatch, log)(event, request),
    ).rejects.toThrow('BRIDGE_REJECTED');
    expect(dispatch).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([['SENDER_REJECTED']]);
  },
);
