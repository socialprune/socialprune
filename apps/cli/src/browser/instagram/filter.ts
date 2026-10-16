import type { Locator, Page } from 'playwright-core';
import { ContextStop } from './report.ts';
import { checkPage } from './selectors.ts';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
type Side = 'start' | 'end';
type Unit = 'year' | 'month' | 'day';
export interface FilterChoice {
  side: Side;
  unit: Unit;
  value: number;
}
function refuse(): never {
  throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'filter-control');
}
function values(labels: string[], unit: Unit): number[] | null {
  if (!labels.length) return null;
  const result = labels.map((label) => {
    if (unit === 'month')
      return (
        MONTHS.findIndex(
          (month) => month.toLowerCase() === label.toLowerCase(),
        ) + 1
      );
    return (unit === 'year' ? /^\d{4}$/ : /^\d{1,2}$/).test(label)
      ? Number(label)
      : 0;
  });
  const maximum = unit === 'month' ? 12 : unit === 'day' ? 31 : 9999;
  return result.every(
    (value) => value >= (unit === 'year' ? 1000 : 1) && value <= maximum,
  ) && new Set(result).size === result.length
    ? result
    : null;
}
async function controls(
  page: Page,
  side: Side,
): Promise<Record<Unit, Locator>> {
  const order = page.getByRole('button', {
    name: 'Oldest to newest',
    exact: true,
  });
  if ((await order.count()) !== 1) refuse();
  // The real page has nested dialogs. Bind to the order button's nearest one,
  // then intersect heading-relative axes with that dialog's own six selects.
  const dialog = order.locator('xpath=ancestor::*[@role="dialog"][1]');
  if (
    (await dialog.count()) !== 1 ||
    !(await dialog.isVisible()) ||
    (await dialog
      .getByRole('button', { name: 'Newest to oldest', exact: true })
      .count()) !== 1 ||
    (await dialog
      .getByRole('button', { name: 'Apply', exact: true })
      .count()) !== 1 ||
    (await page.locator('[role="dialog"] select').count()) !== 6 ||
    (await dialog.locator('select').count()) !== 6
  )
    refuse();
  const start = dialog.getByText(/^start date$/i),
    end = dialog.getByText(/^end date$/i);
  if ((await start.count()) !== 1 || (await end.count()) !== 1) refuse();
  const all = dialog.locator('select'),
    groups = {
      start: all
        .and(start.locator('xpath=following::select'))
        .and(end.locator('xpath=preceding::select')),
      end: all.and(end.locator('xpath=following::select')),
    };
  const result = {} as Record<Side, Record<Unit, Locator>>;
  for (const key of ['start', 'end'] as const) {
    if ((await groups[key].count()) !== 3) refuse();
    const found: Partial<Record<Unit, Locator>> = {};
    for (const select of await groups[key].all()) {
      if (
        !(await select.isVisible()) ||
        !(await select.isEnabled()) ||
        (await select.getAttribute('multiple')) !== null
      )
        refuse();
      const labels = await select.locator('option').allInnerTexts();
      const kinds = (['year', 'month', 'day'] as const).filter((unit) =>
        values(labels, unit),
      );
      if (kinds.length !== 1 || found[kinds[0]!]) refuse();
      found[kinds[0]!] = select;
    }
    if (!found.year || !found.month || !found.day) refuse();
    result[key] = { year: found.year, month: found.month, day: found.day };
  }
  return result[side];
}
/** Only currently offered entries in the open six-list filter may be chosen. */
export async function chooseFilterOption(
  page: Page,
  choice: FilterChoice,
  guard: () => void,
): Promise<void> {
  guard();
  if (
    !['start', 'end'].includes(choice.side) ||
    !['year', 'month', 'day'].includes(choice.unit) ||
    !Number.isInteger(choice.value)
  )
    refuse();
  await checkPage(page);
  let select: Locator, label: string;
  try {
    select = (await controls(page, choice.side))[choice.unit];
    const labels = await select.locator('option').allInnerTexts(),
      offered = values(labels, choice.unit),
      index = offered?.indexOf(choice.value) ?? -1;
    if (index < 0 || !(await select.locator('option').nth(index).isEnabled()))
      refuse();
    label = labels[index]!;
  } catch {
    refuse();
  }
  guard();
  try {
    await select.selectOption({ label }, { timeout: 5000 });
    const checked = await select.locator('option:checked').allInnerTexts();
    if (checked.length !== 1 || checked[0] !== label) refuse();
  } catch {
    refuse();
  }
  guard();
}
export async function chooseFilterDate(
  page: Page,
  side: Side,
  date: string,
  guard: () => void,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) refuse();
  const at = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== date)
    refuse();
  for (const [unit, value] of [
    ['year', at.getUTCFullYear()],
    ['month', at.getUTCMonth() + 1],
    ['day', at.getUTCDate()],
  ] as const)
    await chooseFilterOption(page, { side, unit, value }, guard);
}
