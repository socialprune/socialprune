import { expect, test } from '@playwright/test';
import { criterionHash } from '@socialprune/core/criteria';
import { restoreLiveFeed, liveFeedFixture } from './feed-fixture.ts';
import { checkAccessibility } from './accessibility.ts';
import { readFile } from 'node:fs/promises';
const en = JSON.parse(
  await readFile(new URL('../src/i18n/en.json', import.meta.url), 'utf8'),
) as Record<MessageKey, string>;
const de = JSON.parse(
  await readFile(new URL('../src/i18n/de.json', import.meta.url), 'utf8'),
) as Record<MessageKey, string>;
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { env } from 'node:process';
type MessageKey = keyof MessageArguments;
type PendingRuleSave = {
  calls: number;
  replies: number;
  release: () => void;
};

for (const lang of ['de', 'en'] as const)
  test(`editor and held cards use the same rule wording ${lang}`, async ({
    page,
  }) => {
    await page.addInitScript((locale) => {
      localStorage.setItem('sp-locale', locale);
    }, lang);
    await restoreLiveFeed(page);
    const messages = lang === 'de' ? de : en;
    const rule =
      lang === 'de'
        ? 'Nie löschen mit mindestens 10 Gefällt mir'
        : 'Never delete with 10 likes or more';
    await page
      .getByRole('tab', {
        name: new RegExp(`^${messages['reviewFeed.tab.held']},`),
      })
      .click();
    await expect(page.getByRole('feed')).toContainText(rule);
    await page
      .getByRole('button', {
        name: messages['reviewFeed.changeShort'],
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('checkbox', { name: rule, exact: true }),
    ).toBeChecked();
    const hint =
      lang === 'de'
        ? 'Grenzen wie Gefällt mir oder ein Datum stellst du bei „Deine Regeln“ ein.'
        : 'Set limits such as likes or a date under “Your rules”.';
    await expect(page.getByText(hint, { exact: false })).toBeVisible();
  });

for (const lang of ['de', 'en'] as const)
  test(`add-rule chooser has a text label without a bare plus ${lang}`, async ({
    page,
  }) => {
    const messages = lang === 'de' ? de : en;
    await page.addInitScript((locale) => {
      localStorage.setItem('sp-locale', locale);
    }, lang);
    await restoreLiveFeed(page);
    await page
      .getByRole('button', {
        name: messages['reviewFeed.changeShort'],
        exact: true,
      })
      .click();
    const chooser = page.getByRole('combobox', {
      name: messages['keepRules.add'],
      exact: true,
    });
    await expect(chooser).toBeVisible();
    const label = chooser.locator('..');
    await expect(label).toContainText(messages['keepRules.add']);
    await expect(label.locator('..').locator(':scope > svg')).toHaveCount(0);
    await chooser.selectOption('reposts');
    await expect(
      page.getByRole('spinbutton', {
        name: messages['keepRules.repostsValue'],
        exact: true,
      }),
    ).toHaveValue('10');
  });

test('picker saves counts on tick and rules move entries without decisions', async ({
  page,
  context,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const political = page.getByRole('checkbox', {
    name: /^Political /,
  });
  await political.uncheck();
  await expect(page.getByRole('status').last()).toContainText('Changes saved.');
  await expect(
    page.getByText(
      'Your criteria suggest 0 entries for deletion. Your rules hold back 0 of them.',
    ),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-criteria-footer]')
      .getByText(
        'Your criteria suggest 0 entries for deletion. Your rules hold back 0 of them.',
        { exact: true },
      ),
  ).toBeVisible();
  await political.check();
  await expect(
    page.getByText(
      'Your criteria suggest 3 entries for deletion. Your rules hold back 1 of them.',
    ),
  ).toBeVisible();
  await page
    .getByRole('checkbox', {
      name: 'Never delete with 10 likes or more',
      exact: true,
    })
    .uncheck();
  await expect(
    page.getByText(
      'Your criteria suggest 4 entries for deletion. Your rules hold back 0 of them.',
    ),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: en['keepRules.add'], exact: true })
    .selectOption('likes');
  const likes = page
    .getByRole('spinbutton', {
      name: en['keepRules.likesValue'],
      exact: true,
    })
    .last();
  await likes.fill('2');
  await likes.blur();
  await expect(
    page.getByText(
      'Your criteria suggest 3 entries for deletion. Your rules hold back 1 of them.',
    ),
  ).toBeVisible();
  await checkAccessibility(page, context);
  await page
    .getByRole('button', { name: 'Use these criteria', exact: true })
    .click();
  await expect(
    page.getByRole('tab', { name: /^Held back by your rules/ }),
  ).toHaveAccessibleName('Held back by your rules, 1 entry');
  await page.reload();
  await expect(
    page.getByRole('tab', { name: /^Held back by your rules/ }),
  ).toHaveAccessibleName('Held back by your rules, 1 entry');
  const stored = await page.evaluate(() => window.workspace.summary);
  expect(stored?.counts.decisionEvents).toBe(
    liveFeedFixture().decisionEvents.length,
  );
});

test('own criteria can be added, edited and removed without reusing an ID', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page
    .getByRole('textbox', { name: en['criteriaPicker.label'], exact: true })
    .fill('Violet toolbox');
  await page
    .getByRole('textbox', {
      name: en['criteriaPicker.description'],
      exact: true,
    })
    .fill('Mentions an invented violet toolbox.');
  await page
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /^Violet toolbox/ }),
  ).toBeChecked();
  await page
    .getByRole('button', { name: 'Edit Violet toolbox', exact: true })
    .click();
  await page
    .getByRole('textbox', {
      name: en['criteriaPicker.description'],
      exact: true,
    })
    .fill('Mentions an invented silver toolbox.');
  await page
    .getByRole('button', { name: 'Save criterion', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.workspace.summary?.criteria?.custom[0]?.description,
      ),
    )
    .toBe('Mentions an invented silver toolbox.');
  await page
    .getByRole('button', { name: 'Remove Violet toolbox', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.workspace.summary?.criteria?.custom.length),
    )
    .toBe(0);
  expect(
    await page.evaluate(() => window.workspace.summary?.criteria?.nextCustom),
  ).toBe(2);
});

test('editing a checked own description invalidates its earlier checks without decisions', async ({
  page,
}) => {
  const data = liveFeedFixture();
  data.settings.categories.push('custom-1');
  data.settings.criteria!.custom = [
    {
      id: 'custom-1',
      label: 'Violet toolbox',
      description: 'Mentions a violet toolbox.',
      createdAt: data.createdAt,
    },
  ];
  data.settings.criteria!.nextCustom = 2;
  data.settings.criteria!.selected = ['custom-1'];
  data.submissions[0]!.criteria!.push({
    id: 'custom-1',
    hash: criterionHash('custom-1', data.settings),
  });
  await restoreLiveFeed(page, data);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const option = page.getByRole('checkbox', { name: /^Violet toolbox/ });
  await expect(option).not.toHaveAccessibleName(/Not checked yet/);
  await page
    .getByRole('button', { name: 'Edit Violet toolbox', exact: true })
    .click();
  await page
    .getByRole('textbox', {
      name: en['criteriaPicker.description'],
      exact: true,
    })
    .fill('Mentions a silver toolbox.');
  await page
    .getByRole('button', { name: 'Save criterion', exact: true })
    .click();
  await expect(option).toHaveAccessibleName(/Not checked yet for 8 entries/);
  expect(
    await page.evaluate(() => window.workspace.summary?.counts.decisionEvents),
  ).toBe(data.decisionEvents.length);
});

test('a rejected rule change rolls back the visible toggle and reports the failed save', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.evaluate(() => {
    window.workspace.setKeepRules = () =>
      Promise.reject(new Error('Generated test-only storage failure'));
  });
  const likes = page.getByRole('checkbox', {
    name: 'Never delete with 10 likes or more',
    exact: true,
  });
  // The rejected write rolls back before Playwright's uncheck postcondition.
  await likes.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(likes).toBeChecked();
  await expect(
    page.getByText(en['criteriaPicker.saved'], { exact: true }),
  ).toBeHidden();
});

test('a content limit offers a deterministic rule instead of adding an own criterion', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page
    .getByRole('textbox', { name: en['criteriaPicker.label'], exact: true })
    .fill('At least 20 likes');
  await expect(
    page.getByText(en['criteriaPicker.limit'], { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add criterion', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: en['keepRules.add'], exact: true })
    .click();
  await expect(page.getByRole('spinbutton').last()).toHaveValue('20');
  // The field is optimistic; only the worker receipt updates the summary.
  await page.evaluate(() => window.workspace.flushCommands());
  expect(
    await page.evaluate(() => window.workspace.summary?.criteria?.custom),
  ).toEqual([]);
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'likes-at-least', count: 20, enabled: true });
  await page.reload();
  await expect(page.getByRole('feed')).toBeVisible();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'likes-at-least', count: 20, enabled: true });
});

test('a pending offered rule and the final number edit persist after their replies', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.evaluate(() => {
    const save = window.workspace.setKeepRules.bind(window.workspace);
    const pending = {
      calls: 0,
      replies: 0,
      release: () => {},
    };
    Reflect.set(window, '__pendingRuleSave', pending);
    window.workspace.setKeepRules = async (rules) => {
      pending.calls++;
      await new Promise<void>((resolve) => {
        pending.release = resolve;
      });
      const reply = await save(rules);
      pending.replies++;
      return reply;
    };
  });
  await page
    .getByRole('textbox', { name: en['criteriaPicker.label'], exact: true })
    .fill('At least 20 likes');
  await page
    .getByRole('button', { name: en['keepRules.add'], exact: true })
    .click();
  const value = page.getByRole('spinbutton').last();
  await expect(value).toHaveValue('20');
  await expect(value).toBeDisabled();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules),
  ).toEqual([expect.objectContaining({ id: 'likes-ten', count: 10 })]);
  expect(
    await page.evaluate(() => {
      const pending = Reflect.get(
        window,
        '__pendingRuleSave',
      ) as PendingRuleSave;
      return { calls: pending.calls, replies: pending.replies };
    }),
  ).toEqual({ calls: 1, replies: 0 });
  await page.evaluate(() => {
    (Reflect.get(window, '__pendingRuleSave') as PendingRuleSave).release();
  });
  await expect(value).toBeEnabled();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'likes-at-least', count: 20, enabled: true });
  await value.fill('3');
  await value.fill('30');
  await value.blur();
  await expect(value).toBeDisabled();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ count: 20 });
  await page.evaluate(() => {
    (Reflect.get(window, '__pendingRuleSave') as PendingRuleSave).release();
  });
  await expect(value).toBeEnabled();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'likes-at-least', count: 30, enabled: true });
  expect(
    await page.evaluate(
      () =>
        (Reflect.get(window, '__pendingRuleSave') as PendingRuleSave).replies,
    ),
  ).toBe(2);
  await page.reload();
  await expect(page.getByRole('feed')).toBeVisible();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'likes-at-least', count: 30, enabled: true });
});

test('all rule kinds persist, invalid drafts stay out and unknown inclusion is explicit', async ({
  page,
}) => {
  await restoreLiveFeed(page);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const add = page.getByRole('combobox', {
    name: en['keepRules.add'],
    exact: true,
  });
  await add.selectOption('reposts');
  const reposts = page.getByRole('spinbutton', {
    name: en['keepRules.repostsValue'],
    exact: true,
  });
  await reposts.fill('1.5');
  await reposts.blur();
  await expect(page.getByRole('alert')).toHaveText(en['keepRules.invalid']);
  await expect(
    page.getByRole('button', {
      name: en['reviewFeed.applyCriteria'],
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.workspace.summary?.keepRules?.at(-1)),
  ).toMatchObject({ kind: 'reposts-at-least', count: 10 });
  await reposts.fill('5');
  await reposts.blur();
  await expect(page.getByRole('alert')).toBeHidden();
  await page
    .getByRole('checkbox', { name: en['keepRules.unknown'], exact: true })
    .last()
    .check();
  await expect(page.getByRole('status').last()).toContainText('Changes saved.');
  await add.selectOption('date');
  const date = page.getByLabel(en['keepRules.dateValue'], { exact: true });
  await date.fill('2024-01-01');
  await date.blur();
  await expect(page.getByRole('status').last()).toContainText('Changes saved.');
  await add.selectOption('top-tenth');
  await expect(
    page.getByRole('checkbox', { name: en['keepRules.top'], exact: true }),
  ).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.workspace.summary?.keepRules))
    .toEqual([
      {
        id: 'likes-ten',
        kind: 'likes-at-least',
        enabled: true,
        count: 10,
        alsoWhenUnknown: false,
      },
      expect.objectContaining({
        kind: 'reposts-at-least',
        enabled: true,
        count: 5,
        alsoWhenUnknown: true,
      }),
      expect.objectContaining({
        kind: 'created-from',
        enabled: true,
        date: '2024-01-01',
      }),
      expect.objectContaining({ kind: 'top-liked-tenth', enabled: true }),
    ]);
});

test('a 32-earlier workspace frees room through removal', async ({ page }) => {
  const data = liveFeedFixture();
  data.settings.categories = Array.from(
    { length: 32 },
    (_, n) => `earlier-${n + 1}`,
  );
  data.settings.criteria = {
    selected: [...data.settings.categories],
    custom: [],
    nextCustom: 1,
    level: 0,
  };
  await restoreLiveFeed(page, data);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(
    page.getByText(
      'All 32 criterion slots are selected. Untick one to select another.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: /^Political / }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Remove earlier-1', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', {
      name: new RegExp(`^${en['review.categoryToxic']}`),
    }),
  ).toBeEnabled();
  const summary = await page.evaluate(() => window.workspace.summary);
  expect(summary?.categories).not.toContain('earlier-1');
  expect(summary?.categories).toHaveLength(32);
  expect(summary?.criteria?.selected).toHaveLength(31);
});

test('demo first start has example suggestions but no checked criteria', async ({
  page,
}) => {
  await page.goto('/socialprune/#/demo');
  const start = page.getByRole('button', {
    name: 'Choose criteria',
    exact: true,
  });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(
    page.getByLabel(en['criteriaPicker.label'], { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: en['keepRules.title'], exact: true }),
  ).toBeVisible();
});

for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 1280])
      test(`capture live picker and rules ${lang} ${theme} ${width}`, async ({
        page,
      }) => {
        const messages = lang === 'de' ? de : en;
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        await restoreLiveFeed(page);
        await page
          .getByRole('button', {
            name: messages['reviewFeed.changeShort'],
            exact: true,
          })
          .click();
        const folder =
          env['SP_S4_CAPTURE_DIR'] ?? join(tmpdir(), 'socialprune-feed-s4');
        if (env['SP_S4_CAPTURE_DIR']) {
          await mkdir(folder, { recursive: true });
          await page.screenshot({
            path: join(folder, `picker-${lang}-${theme}-${width}.png`),
          });
        }
        await page
          .getByRole('textbox', {
            name: messages['criteriaPicker.label'],
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        if (env['SP_S4_CAPTURE_DIR'])
          await page.screenshot({
            path: join(folder, `own-criterion-${lang}-${theme}-${width}.png`),
          });
        await page
          .getByRole('heading', {
            name: messages['keepRules.title'],
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        if (env['SP_S4_CAPTURE_DIR'])
          await page.screenshot({
            path: join(folder, `rules-${lang}-${theme}-${width}.png`),
          });
        await page
          .getByRole('button', {
            name: messages['reviewFeed.applyCriteria'],
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        if (env['SP_S4_CAPTURE_DIR'])
          await page.screenshot({
            path: join(folder, `rules-bottom-${lang}-${theme}-${width}.png`),
          });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await expect(
          page.getByRole('combobox', {
            name: messages['keepRules.add'],
            exact: true,
          }),
        ).toBeVisible();
        await page.goto('/socialprune/#/demo');
        await expect(
          page.getByRole('button', {
            name: messages['reviewFeed.chooseCriteria'],
            exact: true,
          }),
        ).toBeVisible();
        if (env['SP_S4_CAPTURE_DIR'])
          await page.screenshot({
            path: join(folder, `first-start-${lang}-${theme}-${width}.png`),
          });
        await page
          .getByRole('button', {
            name: messages['reviewFeed.chooseCriteria'],
            exact: true,
          })
          .click();
        await page
          .getByRole('heading', {
            name: messages['criteriaPicker.examples'],
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await expect(page.getByRole('checkbox').first()).not.toBeChecked();
        if (env['SP_S4_CAPTURE_DIR'])
          await page.screenshot({
            path: join(folder, `demo-examples-${lang}-${theme}-${width}.png`),
          });
      });
