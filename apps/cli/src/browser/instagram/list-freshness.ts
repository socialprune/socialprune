import { createHmac, randomBytes } from 'node:crypto';
import type { Page } from 'playwright-core';
import { normalize } from './plan.ts';
import type { RowSignatureDiagnostic } from './report.ts';

/** Run-local keyed hashes only. No digest or page value enters a report. */
export function listFreshness() {
  const key = randomBytes(32);
  let previous: { rows: string; window: string } | undefined;
  let before: string | null = null;
  let current: string | null = null;
  let window: string | null = null;
  const digest = (value: string) =>
    createHmac('sha256', key).update(value).digest('hex');
  const read = async (page: Page): Promise<string | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const hash = createHmac('sha256', key);
          // The filter dialog disappearing is not a refresh of the result rows.
          const containers = page.locator(
            'xpath=//*[@role="button" and @aria-label and not(ancestor::*[@role="dialog"])]',
          );
          const texts = await containers.allInnerTexts();
          hash.update(JSON.stringify(texts.map(normalize)));
          for (const [index] of texts.entries()) {
            const row = containers.nth(index);
            hash.update(JSON.stringify(await row.getAttribute('aria-label')));
            for (const image of await row.locator('img').all())
              hash.update(
                JSON.stringify([
                  await image.getAttribute('src'),
                  await image.getAttribute('alt'),
                ]),
              );
          }
          return hash.digest('hex');
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Row signature read expired')),
            1000,
          );
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async beforeApply(page: Page, dates: readonly [string, string]) {
      before = await read(page);
      current = null;
      window = digest(JSON.stringify(dates));
    },
    async inspect(page: Page): Promise<RowSignatureDiagnostic> {
      current = await read(page);
      return {
        observed: current !== null && before !== null,
        sameAsBeforeApply:
          current !== null && before !== null ? current === before : null,
        sameAsPreviousStep:
          current !== null && previous && window
            ? current === previous.rows
            : null,
        previousWindowDifferent:
          previous && window ? previous.window !== window : null,
      };
    },
    finish() {
      // Unknown observations break the comparison chain; never reuse an older step.
      previous =
        current !== null && window !== null
          ? { rows: current, window }
          : undefined;
      before = current = window = null;
    },
  };
}
export type ListFreshness = ReturnType<typeof listFreshness>;
