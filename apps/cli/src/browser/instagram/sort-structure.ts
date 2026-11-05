import type { Locator, Page } from 'playwright-core';
import type { SortControlStructure } from './report.ts';

export const emptySortStructure = (): SortControlStructure => ({
  observed: false,
  capped: false,
  element: null,
  descendants: { input: 0, label: 0, radio: 0 },
  ancestors: { input: 0, label: 0, radio: 0 },
  nearestDescendant: null,
  nearestAncestor: null,
  applyEnabled: null,
});
const TAGS = [
  'button',
  'div',
  'span',
  'input',
  'label',
  'select',
  'option',
  'li',
  'ul',
  'section',
  'form',
  'main',
  'body',
  'html',
] as const;
const ROLES = [
  'button',
  'radio',
  'option',
  'radiogroup',
  'listbox',
  'checkbox',
  'dialog',
] as const;
type ElementView = NonNullable<SortControlStructure['element']>;
const OPTION =
  '@role="radio" or @role="option" or self::input[@type="radio"] or self::option';
async function project(node: Locator): Promise<ElementView> {
  const tags = await Promise.all(
    TAGS.map((tag) => node.locator(`xpath=self::${tag}`).count()),
  );
  const tag = TAGS.find((_, index) => tags[index] === 1) ?? 'other';
  const rawRole = await node.getAttribute('role', { timeout: 150 });
  const role =
    ROLES.find((value) => value === rawRole) ?? (rawRole ? 'other' : null);
  const state = async (attribute: string) => {
    const value = await node.getAttribute(attribute, { timeout: 150 });
    return value === null ? null : value === 'true';
  };
  const states = await Promise.all(
    ['aria-checked', 'aria-selected', 'aria-pressed', 'data-selected'].map(
      state,
    ),
  );
  const input = node.locator(
    'xpath=self::input[@type="radio" or @type="checkbox"]',
  );
  return {
    tag,
    role,
    checked:
      (await input.count()) === 1
        ? await input.isChecked({ timeout: 150 })
        : null,
    ariaChecked: states[0]!,
    ariaSelected: states[1]!,
    ariaPressed: states[2]!,
    dataSelected: states[3]!,
  };
}
/** Bounded read-only locators, no page scripts, text, identities or mutations. */
export async function sortControlStructure(
  page: Page,
  name: 'Oldest to newest' | 'Newest to oldest',
  guard: () => void,
): Promise<SortControlStructure> {
  guard();
  const result = emptySortStructure();
  try {
    const control = page.getByRole('button', { name, exact: true });
    if ((await control.count()) !== 1) return result;
    result.element = await project(control);
    for (const [key, selector] of [
      ['input', 'self::input'],
      ['label', 'self::label'],
      ['radio', 'self::input[@type="radio"] or @role="radio"'],
    ] as const) {
      result.descendants[key] = await control
        .locator(`xpath=descendant::*[${selector}]`)
        .count();
      result.ancestors[key] = await control
        .locator(`xpath=ancestor::*[${selector}]`)
        .count();
    }
    // Breadth first by depth, rather than picking an unrelated earlier subtree.
    if (await control.locator(`xpath=descendant::*[${OPTION}]`).count()) {
      for (let depth = 1; depth <= 12; depth++) {
        const candidate = control.locator(
          `xpath=${'*/'.repeat(depth - 1)}*[${OPTION}]`,
        );
        if (await candidate.count()) {
          result.nearestDescendant = await project(candidate.first());
          break;
        }
        if (depth === 12) result.capped = true;
      }
    }
    const ancestor = control.locator(`xpath=ancestor::*[${OPTION}][1]`);
    if ((await ancestor.count()) === 1)
      result.nearestAncestor = await project(ancestor);
    const apply = page.getByRole('button', { name: 'Apply', exact: true });
    if ((await apply.count()) === 1)
      result.applyEnabled =
        (await apply.isEnabled()) &&
        (await apply.getAttribute('aria-disabled', { timeout: 150 })) !==
          'true';
    result.observed = true;
    guard();
    return result;
  } catch {
    guard();
    return result;
  }
}
