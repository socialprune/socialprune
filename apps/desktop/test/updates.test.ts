import { expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mainMethods } from '../src/main/methods.ts';
import { DesktopRequestSchema, parseDesktopReply } from '../src/protocol.ts';
import { HostCommandSchema } from '../src/host-protocol.ts';
import { assertNoOwnedNetwork } from '../packaging/network-check.ts';

test('app information opens nothing; only an explicit releases link request reaches the existing opener', async () => {
  const external = vi.fn().mockResolvedValue(undefined);
  const dispatch = mainMethods({
    dataDirectory: 'C:\\Generated',
    guides: [],
    folder: vi.fn(),
    external,
    appInfo: () => ({ version: '1.2.3', build: 'direct' }),
  });
  expect(external).not.toHaveBeenCalled();
  const request = DesktopRequestSchema.parse({
    type: 'appInfo',
    requestId: 'version',
  });
  expect(parseDesktopReply(request, await dispatch(request))).toEqual({
    type: 'appInfo',
    requestId: 'version',
    version: '1.2.3',
    build: 'direct',
  });
  expect(external).not.toHaveBeenCalled();
  const click = DesktopRequestSchema.parse({
    type: 'openLink',
    requestId: 'click',
    link: {
      kind: 'app-releases',
      url: 'https://github.com/socialprune/socialprune/releases',
    },
  });
  expect(await dispatch(click)).toMatchObject({ type: 'linkOpened' });
  expect(external).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/socialprune/socialprune/releases',
  );
});

test('release smoke still rejects owned network activity and renderer retains connect-src none', async () => {
  expect(() =>
    assertNoOwnedNetwork({
      ticks: 1,
      observed: [],
      violations: ['generated-remote-tcp'],
    }),
  ).toThrow('OWNED_NETWORK');
  expect(() =>
    assertNoOwnedNetwork({ ticks: 0, observed: [], violations: [] }),
  ).toThrow('NETWORK_OBSERVATION_MISSING');
  const smoke = await readFile(
    new URL('../packaging/release-smoke.ts', import.meta.url),
    'utf8',
  );
  expect(smoke).toContain('assertNoOwnedNetwork(networkObservation)');
  const policy = await readFile(
    new URL('../src/main/policy.ts', import.meta.url),
    'utf8',
  );
  expect(policy).toContain("connect-src 'none'");
});

test('app information is main-only and OS packaging identity, not a renderer-supplied version or build', async () => {
  expect(
    DesktopRequestSchema.safeParse({
      type: 'appInfo',
      requestId: 'bad',
      version: '9.9.9',
      build: 'store',
    }).success,
  ).toBe(false);
  expect(
    HostCommandSchema.safeParse({
      type: 'request',
      message: { request: { type: 'appInfo', requestId: 'engine-forbidden' } },
    }).success,
  ).toBe(false);
  const source = await readFile(
    new URL('../src/main/app.ts', import.meta.url),
    'utf8',
  );
  expect(source).toContain('app.getVersion()');
  expect(source).toContain('process.windowsStore');
  expect(source).toContain("request.type === 'appInfo'");
});

test('main resolver defends against an invalid releases route even without the renderer schema', async () => {
  const external = vi.fn();
  const dispatch = mainMethods({
    dataDirectory: 'C:\\Generated',
    guides: [],
    folder: vi.fn(),
    external,
    appInfo: () => ({ version: '1.2.3', build: 'direct' }),
  });
  expect(
    await dispatch({
      type: 'openLink',
      requestId: 'forged',
      link: {
        kind: 'app-releases',
        url: 'https://github.com/socialprune/socialprune/releases/latest',
      },
    }),
  ).toMatchObject({ type: 'desktopFailed', code: 'LINK_UNKNOWN' });
  expect(external).not.toHaveBeenCalled();
});

test('Store identity refuses the releases action even if a renderer forges its click', async () => {
  const external = vi.fn();
  const dispatch = mainMethods({
    dataDirectory: 'C:\\Generated',
    guides: [],
    folder: vi.fn(),
    external,
    appInfo: () => ({ version: '1.2.3', build: 'store' }),
  });
  expect(
    await dispatch({
      type: 'openLink',
      requestId: 'store',
      link: {
        kind: 'app-releases',
        url: 'https://github.com/socialprune/socialprune/releases',
      },
    }),
  ).toMatchObject({ type: 'desktopFailed', code: 'NOT_AVAILABLE' });
  expect(external).not.toHaveBeenCalled();
});
