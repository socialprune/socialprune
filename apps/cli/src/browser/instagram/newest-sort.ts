import type { Page } from 'playwright-core';
import { clickAllowed } from './selectors.ts';
import { probeWait } from './list-probe.ts';
import type { NewestProbe } from './report.ts';

export const emptySortDiagnostic = (): NonNullable<NewestProbe['sort']> => ({
  menuControlFound: false,
  controlFound: false,
  optionsOffered: 0,
  selectedBefore: false,
  clickTarget: 'not-clicked',
  chosenReadback: false,
  applyFound: false,
  applyEnabled: null,
  applySkipped: false,
  listChangeObserved: null,
  elapsedMs: 0,
  failedStep: 'none',
});
export async function applyNewestSort(
  page: Page,
  guard: () => void,
  checked: () => Promise<void>,
  diagnostic = emptySortDiagnostic(),
) {
  const started = performance.now();
  try {
    diagnostic.failedStep = 'open';
    const menu = page.getByRole('button', {
      name: 'Sort & filter',
      exact: true,
    });
    diagnostic.menuControlFound =
      (await menu.count()) === 1 && (await menu.isVisible());
    await probeWait(
      'newest-open-sort',
      () => clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard),
      checked,
    );
    const control = page.getByRole('button', {
      name: 'Newest to oldest',
      exact: true,
    });
    const selected = async () =>
      (
        await Promise.all(
          ['aria-checked', 'aria-pressed', 'data-selected'].map((attribute) =>
            control.getAttribute(attribute, { timeout: 150 }),
          ),
        )
      ).some((value) => value === 'true') ||
      (await control.locator('input:checked,[aria-checked="true"]').count()) ===
        1;
    diagnostic.failedStep = 'options';
    diagnostic.controlFound =
      (await control.count()) === 1 && (await control.isVisible());
    diagnostic.optionsOffered = await page
      .getByRole('button', { name: /^(?:Oldest to newest|Newest to oldest)$/u })
      .count();
    diagnostic.failedStep = 'readback';
    diagnostic.selectedBefore = await probeWait(
      'newest-sort-readback',
      selected,
      checked,
    );
    if (!diagnostic.selectedBefore) {
      diagnostic.failedStep = 'select';
      diagnostic.clickTarget = 'named-role-button';
      await probeWait(
        'newest-select-sort',
        () =>
          clickAllowed(
            page,
            { kind: 'named', name: 'Newest to oldest' },
            guard,
          ),
        checked,
      );
    }
    diagnostic.failedStep = 'readback';
    diagnostic.chosenReadback = await probeWait(
      'newest-sort-readback',
      selected,
      checked,
    );
    diagnostic.failedStep = 'apply';
    const apply = page.getByRole('button', { name: 'Apply', exact: true });
    diagnostic.applyFound = (await apply.count()) === 1;
    if (diagnostic.applyFound)
      diagnostic.applyEnabled = await probeWait(
        'newest-apply',
        async () =>
          (await apply.isEnabled()) &&
          (await apply.getAttribute('aria-disabled', { timeout: 150 })) !==
            'true',
        checked,
      );
    diagnostic.applySkipped =
      diagnostic.selectedBefore &&
      diagnostic.chosenReadback &&
      diagnostic.applyEnabled === false;
    diagnostic.failedStep = 'apply';
    if (!diagnostic.applySkipped)
      await probeWait(
        'newest-apply',
        () => clickAllowed(page, { kind: 'named', name: 'Apply' }, guard),
        checked,
      );
    diagnostic.failedStep = 'none';
    return diagnostic;
  } finally {
    diagnostic.elapsedMs = Math.max(0, Math.round(performance.now() - started));
  }
}
