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
      clickTarget: 'not-clicked',
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
        clickTarget: 'named-role-button',
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

test('newestpick Oldest and Newest use the identical allow-listed named-button action', async () => {
  const calls: unknown[] = [];
  const control = {
    count: () => Promise.resolve(1),
    isVisible: () => Promise.resolve(true),
    click: (options: unknown) => {
      calls.push(options);
      return Promise.resolve();
    },
  };
  const locator = {
    getAttribute: () => Promise.resolve('en'),
    getByText: () => ({ count: () => Promise.resolve(0) }),
    filter() {
      return this;
    },
  };
  const named: unknown[] = [];
  const page = {
    isClosed: () => false,
    url: () => 'https://www.instagram.com/your_activity/interactions/comments/',
    locator: () => locator,
    getByText: () => ({ count: () => Promise.resolve(0) }),
    getByRole: (role: string, options: unknown) => {
      named.push({ role, options });
      return control;
    },
  } as unknown as Page;
  for (const name of ['Oldest to newest', 'Newest to oldest'] as const)
    await selectors.clickAllowed(page, { kind: 'named', name }, () => {});
  expect(named).toEqual([
    { role: 'button', options: { name: 'Oldest to newest', exact: true } },
    { role: 'button', options: { name: 'Newest to oldest', exact: true } },
  ]);
  expect(calls).toEqual([{ timeout: 5000 }, { timeout: 5000 }]);
});
