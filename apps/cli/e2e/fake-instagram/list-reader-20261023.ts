import type { Page } from 'playwright-core';

// Frozen list-reading slice of selectors.ts at 8ad968d (2026-10-23).
// The same slice is unchanged at 298f4da. Kept test-only so a current reader
// change cannot silently change the historical comparison's oracle.
const normalize = (text: string) =>
  text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const pattern = new RegExp(
  '^([A-Za-z0-9_.]{1,30})\\s+(.+?)\\s+(\\d+\\s*(?:y|w|d|h|m|s|years?|weeks?|days?|hours?|minutes?|seconds?))$',
);
export async function historicalListRows(page: Page) {
  const entries = page
    .locator('[role="button"][aria-label]')
    .filter({ has: page.locator('img') });
  const texts = await entries.allInnerTexts();
  const result = [];
  for (let index = 0; index < texts.length; index++) {
    const raw = normalize(texts[index]!);
    if (!raw) continue;
    const match = pattern.exec(raw);
    if (!match) throw new Error('Historical row-structure stop');
    result.push({
      username: match[1]!,
      text: match[2]!,
      age: match[3]!,
      index,
    });
  }
  return result;
}

/** Generated old list shapes, not a reconstruction of the private current DOM. */
export function historicalListPage(layout: 'old' | 'split' | 'foreign-first') {
  const own = 'generated_handle';
  const text = 'Generated comment text with an independently fixed ending';
  const image = '<img alt="">';
  const row = (value: string) =>
    `<div role="button" aria-label="Comment row">${image}${image}${value}</div>`;
  return {
    own,
    text,
    html: `<main>${
      layout === 'split'
        ? `<li><a href="/generated_other/">generated_other</a> ${text} 1w</li><li>${own} ${text} 2d</li><li>${own} ${text} 8 years</li>`
        : row(`${own} ${text}\n1w`) +
          row(`generated_other ${text} 2d`) +
          row(`${own} Generated different text 8 years`) +
          row('')
    }${layout === 'foreign-first' ? row(`generated_other ${own} ${text} 1w`) : ''}</main>`,
  };
}
