import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), 'utf8');

describe('DESIGN-H C foundation', () => {
  test('declares distinct reading, chrome and action roles without remote resources', async () => {
    const tokens = await source('./tokens.css');
    for (const role of [
      '--type-post',
      '--line-post',
      '--reading-width',
      '--color-header',
      '--color-header-text',
      '--color-header-selected',
      '--radius-workspace',
    ])
      expect(tokens, role).toContain(`${role}:`);
    expect(tokens).not.toMatch(/https?:|@import|@font-face/u);
  });

  test('replaces the side summary without removing its rule count from the final action', async () => {
    const workspace = await source('../review/feed/FeedWorkspace.tsx');
    const feed = await source('../review/feed/ReviewFeed.tsx');
    expect(workspace).not.toContain('<aside className={styles.side}>');
    expect(feed).toContain("t('reviewFeed.heldCount', { count: held })");
    expect(feed).toContain('onKeyboardHelp');
    expect(feed).toContain('props.criteria');
  });

  test('keeps the suggestion mark and metadata distinct from a human decision', async () => {
    const card = await source('../review/feed/FeedCard.tsx');
    expect(card).toContain('<WandSparkles size={16} aria-hidden="true" />');
    expect(card).toContain('sourceLabel(suggestion.source, t)');
    expect(card).toContain('suggestion.category');
    expect(card).toContain('suggestion.reason');
  });

  test('uses the shared control radius for every feed action', async () => {
    const controls = await source('../review/feed/Controls.module.css');
    expect(controls).toContain('border-radius: var(--radius-control)');
    expect(controls).not.toContain('999px');
  });
});
