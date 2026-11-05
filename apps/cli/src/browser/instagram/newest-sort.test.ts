import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import * as selectors from './selectors.ts';
import { applyNewestSort } from './newest-sort.ts';

test('newestreply unchanged newest sort does not wait on its disabled Apply control', async () => {
  const click = vi
    .spyOn(selectors, 'clickAllowed')
    .mockImplementation((_page, action) => {
      if (action.kind === 'named' && action.name === 'Apply')
        return Promise.reject(
          Object.assign(new Error('generated'), { name: 'TimeoutError' }),
        );
      return Promise.resolve();
    });
  const control = {
    count: () => Promise.resolve(1),
    isVisible: () => Promise.resolve(true),
    isEnabled: () => Promise.resolve(false),
    getAttribute: (key: string) =>
      Promise.resolve(key === 'aria-pressed' ? 'true' : null),
    locator: () => ({ count: () => Promise.resolve(0) }),
  };
  const page = { getByRole: () => control } as unknown as Page;
  try {
    const value = await applyNewestSort(
      page,
      () => {},
      async () => {},
    );
    expect(value).toMatchObject({
      selectedBefore: true,
      chosenReadback: true,
      applySkipped: true,
    });
    expect(
      click.mock.calls.some(
        (call) => call[1].kind === 'named' && call[1].name === 'Apply',
      ),
    ).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
});

test.each([true, false])(
  'newestreply changed sort records offered controls and explicit readback=%s',
  async (hasReadback) => {
    let selected = false;
    const click = vi
      .spyOn(selectors, 'clickAllowed')
      .mockImplementation((_page, action) => {
        if (action.kind === 'named' && action.name === 'Newest to oldest')
          selected = true;
        return Promise.resolve();
      });
    const control = {
      count: () => Promise.resolve(1),
      isVisible: () => Promise.resolve(true),
      isEnabled: () => Promise.resolve(true),
      getAttribute: (key: string) =>
        Promise.resolve(
          key === 'aria-pressed' && selected && hasReadback ? 'true' : null,
        ),
      locator: () => ({ count: () => Promise.resolve(0) }),
    };
    const page = {
      getByRole: (_: string, options: { name: string | RegExp }) =>
        options.name instanceof RegExp
          ? { count: () => Promise.resolve(2) }
          : control,
    } as unknown as Page;
    try {
      const result = await applyNewestSort(
        page,
        () => {},
        async () => {},
      );
      expect(result).toMatchObject({
        menuControlFound: true,
        controlFound: true,
        optionsOffered: 2,
        selectedBefore: false,
        chosenReadback: hasReadback,
        applyEnabled: true,
        applySkipped: false,
      });
      expect(
        click.mock.calls.filter(
          (call) => call[1].kind === 'named' && call[1].name === 'Apply',
        ),
      ).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  },
);
