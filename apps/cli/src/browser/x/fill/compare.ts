import type { Page } from 'playwright-core';
import type { Original } from '@socialprune/core';
import { xSelectors } from '../selectors.ts';
export interface CanaryCounts {
  textLength: number;
  photos: number;
  videos: number;
}
export interface CanaryComparison {
  stored: CanaryCounts;
  shown: CanaryCounts;
  matches: boolean;
}
export async function compareNotice(
  page: Page,
  status: 'not-found' | 'tombstone' | 'unavailable',
): Promise<CanaryComparison> {
  const marker =
    status === 'not-found'
      ? page.getByTestId('error-detail').filter({
          hasText:
            /^(?:This Post (?:doesn’t|doesn't) exist\.?|Dieser Post existiert nicht\.?)$/,
        })
      : page.getByTestId('error-detail').filter({
          hasText:
            status === 'tombstone'
              ? /^(?:This Post was deleted by the Post author\.?|Dieser Post wurde vom Autor gelöscht\.?)$/
              : /^(?:This Post is unavailable\.?|Dieser Post ist nicht verfügbar\.?)$/,
        });
  const zero = { textLength: 0, photos: 0, videos: 0 };
  return {
    stored: zero,
    shown: { ...zero },
    matches: (await marker.count()) === 1 && (await marker.isVisible()),
  };
}
export function normalizedLength(text: string): number {
  return text.replace(/\s+/gu, ' ').trim().length;
}
export async function compareFocal(
  page: Page,
  original: Original,
): Promise<CanaryComparison> {
  const article = await xSelectors.focal(page, original.id),
    text = article.getByTestId('tweetText');
  const shownText = (await text.count()) === 1 ? await text.innerText() : '';
  let storedText = original.text ?? '';
  // Compare exactly after whitespace and known rendered link substitutions.
  // Never allow a general length tolerance: a missing long-text tail must fail.
  for (const link of await text.locator('a[href]').all()) {
    const href = await link.getAttribute('href'),
      visible = await link.innerText();
    if (href && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(href) && visible)
      storedText = storedText.replaceAll(href, visible);
  }
  const photos = article
      .getByTestId('tweetPhoto')
      .filter({ hasNot: article.locator('video,[data-testid="videoPlayer"]') }),
    players = article.getByTestId('videoPlayer');
  const stored = {
    textLength: normalizedLength(storedText),
    photos: original.media.filter((media) => media.kind === 'photo').length,
    videos: original.media.filter((media) => media.kind !== 'photo').length,
  };
  const shown = {
    textLength: normalizedLength(shownText),
    photos: await photos.count(),
    videos: (await players.count()) || (await article.locator('video').count()),
  };
  return {
    stored,
    shown,
    matches:
      (await text.count()) === 1 &&
      original.textCompleteness === 'full' &&
      JSON.stringify(stored) === JSON.stringify(shown),
  };
}
