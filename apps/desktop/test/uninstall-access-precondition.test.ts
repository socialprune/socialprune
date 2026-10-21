import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { uninstallAccessDisposition } from './uninstall-access-precondition.ts';

const denied = {
  parentElevated: false,
  debugPrivilegePresent: false,
  debugPrivilegeEnabled: false,
  openSucceeded: false,
  openError: 5,
};

test('fatal-denial proof requires an observed denied open, never a presumed DACL effect', () => {
  expect(uninstallAccessDisposition(denied)).toBe('assert-denied');
  expect(() =>
    uninstallAccessDisposition({
      ...denied,
      openSucceeded: true,
      openError: 0,
    }),
  ).toThrow('UNINSTALL_DENIAL_PRECONDITION_NOT_MET');
  expect(() =>
    uninstallAccessDisposition({ ...denied, openError: 87 }),
  ).toThrow('UNINSTALL_DENIAL_PRECONDITION_NOT_MET');
});

test('an elevated successful open is record-only and never counts as the fatal-denial mechanism', () => {
  for (const debugPrivilegeEnabled of [false, true])
    expect(
      uninstallAccessDisposition({
        ...denied,
        parentElevated: true,
        debugPrivilegePresent: true,
        debugPrivilegeEnabled,
        openSucceeded: true,
        openError: 0,
      }),
    ).toBe('record-only');
  expect(
    uninstallAccessDisposition({
      ...denied,
      debugPrivilegePresent: true,
      debugPrivilegeEnabled: true,
      openSucceeded: true,
      openError: 0,
    }),
  ).toBe('record-only');
  expect(() =>
    uninstallAccessDisposition({
      ...denied,
      parentElevated: true,
      openError: 87,
    }),
  ).toThrow('UNINSTALL_DENIAL_PRECONDITION_NOT_MET');
});

test('the integration records token and actual open before choosing assertions', async () => {
  const source = await readFile(
    join(directory, 'test/installer-fault-lifecycle.test.ts'),
    'utf8',
  );
  expect(source).toContain('UNINSTALL_ACCESS_PRECONDITION');
  expect(source).toContain('uninstallAccessDisposition(precondition)');
  expect(source).toContain('release-uninstall-access-precondition.json');
});
