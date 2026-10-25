import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), 'utf8');

describe('DESIGN-H C editor presentation', () => {
  test('keeps the complete definition outside the checkbox and behind a named disclosure', async () => {
    const picker = await source('./CriteriaPicker.tsx');
    expect(picker).toContain('<details className={styles.definition}>');
    expect(picker).toContain(
      "t('criteriaPicker.definition', { label: option.label })",
    );
    expect(picker).toContain('aria-describedby={`${id}-${option.id}-help`}');
    expect(picker).toContain('{option.description}');
  });

  test('places count, receipt and return outside the editor scroll area', async () => {
    const editor = await source('./ReviewSettings.tsx');
    expect(editor).toContain('data-criteria-scroll');
    expect(editor).toContain('data-criteria-footer');
    expect(editor).toContain('showTotal={false}');
    expect(editor).toContain("t('criteriaPicker.total'");
    expect(editor).toContain('role="status" aria-live="polite"');
  });

  test('uses light dividers instead of a bordered card for every choice', async () => {
    const css = await source('./Criteria.module.css');
    expect(css).toContain(
      'grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr)',
    );
    expect(css).toContain(
      'border-bottom: var(--border-width) solid var(--color-divider)',
    );
    expect(css).not.toMatch(
      /\.option\s*\{[^}]*border:\s*var\(--border-width\) solid var\(--color-boundary\)/u,
    );
  });

  test('keeps confirmation actions separate from its complete scrollable terms', async () => {
    const preview = await source('../feed/MarkPreview.tsx');
    expect(preview).toContain('className={styles.previewBody}');
    expect(preview).toContain('data-preview-actions');
    expect(preview).toContain('disabled={pending || !preview.count}');
    for (const key of [
      'markPreview.held',
      'markPreview.kept',
      'markPreview.criteria',
      'markPreview.nextX',
      'markPreview.nextInstagram',
    ])
      expect(preview).toContain(key);
  });
});
