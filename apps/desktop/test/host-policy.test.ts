import { expect, test, vi } from 'vitest';
import { mainMethods, splitWorkArea } from '../src/main/methods.ts';

test('main resolves only known guide identifiers and closed post routes', async () => {
  const external = vi.fn().mockResolvedValue(undefined);
  const folder = vi.fn().mockResolvedValue('');
  const dispatch = mainMethods({
    dataDirectory: 'C:\\generated\\data',
    external,
    folder,
    guides: [],
    appInfo: () => ({ version: '0.0.0', build: 'direct' }),
  });
  expect(
    await dispatch({
      requestId: 'report',
      type: 'openLink',
      link: { kind: 'guide-report' },
    }),
  ).toEqual({ requestId: 'report', type: 'linkOpened' });
  expect(external).toHaveBeenCalledExactlyOnceWith(
    'https://github.com/socialprune/socialprune/issues/new',
  );
  expect(
    await dispatch({
      requestId: 'unknown',
      type: 'openLink',
      link: {
        kind: 'guide-source',
        platform: 'x',
        factId: 'x.unknown',
        locale: 'en',
      },
    }),
  ).toMatchObject({ type: 'desktopFailed', code: 'LINK_UNKNOWN' });
  expect(
    await dispatch({
      requestId: 'post',
      type: 'openLink',
      link: { kind: 'platform-post', url: 'https://x.com/i/web/status/123' },
    }),
  ).toMatchObject({ type: 'linkOpened' });
  expect(
    await dispatch({ requestId: 'folder', type: 'dataFolderOpen' }),
  ).toEqual({ requestId: 'folder', type: 'dataFolderOpened', opened: true });
  expect(folder).toHaveBeenCalledExactlyOnceWith('C:\\generated\\data');
  expect(external).toHaveBeenCalledTimes(2);
});

test('work-area placement retains negative display coordinates and the narrow-screen branch', () => {
  expect(splitWorkArea({ x: -1920, y: 40, width: 1920, height: 1040 })).toEqual(
    {
      app: { x: -1920, y: 40, width: 960, height: 1040 },
      browser: { x: -960, y: 40, width: 960, height: 1040 },
    },
  );
  expect(splitWorkArea({ x: 0, y: 0, width: 1279, height: 720 })).toBeNull();
});
