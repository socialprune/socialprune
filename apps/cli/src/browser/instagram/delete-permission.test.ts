import { expect, test } from 'vitest';
import { InstagramDeletePermission } from './delete-permission.ts';

const page = { url: () => 'https://www.instagram.com/p/Generated/c/123/' };
const target = {
  page: page as never,
  origin: 'https://www.instagram.com',
  account: 'generated',
  postCode: 'Generated',
  commentId: '123',
  attemptId: 'sending',
};
const request = (
  path = '/api/v1/web/comments/987/delete/123/',
  ownPage: object = page,
) => ({
  url: () => target.origin + path,
  method: () => 'POST',
  postData: () => '',
  frame: () => ({ page: () => ownPage, parentFrame: () => null }),
});
test('D10 deletion permission admits exactly one bound request and never a second request', () => {
  const capability = new InstagramDeletePermission();
  expect(capability.admit(request() as never)).toBe(false);
  capability.arm(target);
  expect(capability.admit(request() as never)).toBe(true);
  expect(capability.admit(request() as never)).toBe(false);
});
test.each([
  ['/api/v1/web/comments/987/delete/456/', page],
  ['/api/v1/web/comments/987/delete/123/', {}],
  ['/api/v1/web/comments/987/delete/123/?extra=1', page],
  ['/api/v1/media/987/comment/bulk_delete/', page],
  ['/api/v1/web/likes/123/like/', page],
])(
  'D10 deletion permission rejects a foreign target or unbound operation %s',
  (path, owner) => {
    const capability = new InstagramDeletePermission();
    capability.arm(target);
    expect(capability.admit(request(path, owner) as never)).toBe(false);
  },
);
test('D10 failed matching cannot be used to arm a second concurrent target', () => {
  const capability = new InstagramDeletePermission();
  capability.arm(target);
  expect(() => capability.arm({ ...target, commentId: '456' })).toThrow();
  capability.disarm();
  expect(capability.admit(request() as never)).toBe(false);
});
test.each([
  [200, '{"status":"ok"}', true],
  [200, '{"status":"fail"}', false],
  [200, '{"status":"ok","unrecognized":true}', false],
  [429, '{"status":"ok"}', false],
  [200, 'not json', false],
] as const)(
  'D10 receipt status=%s accepts only the observed closed shape %s',
  async (status, body, accepted) => {
    const capability = new InstagramDeletePermission();
    capability.arm(target);
    const bound = request();
    expect(capability.admit(bound as never)).toBe(true);
    await capability.response({
      request: () => request(),
      status: () => status,
      url: bound.url,
      headers: () => ({}),
      body: () => Promise.resolve(Buffer.from(body)),
    } as never);
    expect(capability.result()).toBeUndefined();
    await capability.response({
      request: () => bound,
      status: () => status,
      url: bound.url,
      headers: () => ({}),
      body: () => Promise.resolve(Buffer.from(body)),
    } as never);
    expect(capability.result()?.accepted).toBe(accepted);
  },
);
