import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import en from '../../src/i18n/en.json' with { type: 'json' };
import de from '../../src/i18n/de.json' with { type: 'json' };

/** Expected person path, independent of the renderer's navigation data. */
export async function expectDesktopNavigation(page: Page, locale: 'de' | 'en') {
  const messages = locale === 'de' ? de : en;
  const keys = [
    'desktop.setup',
    'review.title',
    'proto.archiveTitle',
    'clicklist.title',
    'desktop.monitor',
    'scan.title',
    'desktop.data',
    'nav.guide',
  ] as const;
  await expect(
    page.getByRole('navigation', { name: 'SocialPrune' }).getByRole('button'),
  ).toHaveText(keys.map((key) => messages[key]));
}
