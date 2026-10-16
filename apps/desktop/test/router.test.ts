import { expect, test, vi } from 'vitest';
import { createRouter } from '../src/main/router.ts';
import type { SenderEvent, SenderIdentity } from '../src/main/router.ts';

const request = {
  requestId: '00000000-0000-4000-8000-000000000001',
  type: 'foundationRead' as const,
};
export function identities() {
  const frame = {
    url: 'app://socialprune/index.html',
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
    type: 'foundationSummary',
    items: 300,
    sqliteVersion: '3.53.4',
  });
  const log = vi.fn();
  const route = createRouter(owner, dispatch, log);
  await expect(route(event, request)).resolves.toMatchObject({ items: 300 });
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
      type: 'foundationSummary',
      items: 300,
      sqliteVersion: '3.53.4',
    });
    const log = vi.fn();
    await expect(
      createRouter(owner, dispatch, log)(event, request),
    ).rejects.toThrow('BRIDGE_REJECTED');
    expect(dispatch).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([['SENDER_REJECTED']]);
  },
);
