import { expect, test } from 'vitest';
import { endText, endReason } from './copy.ts';
import type { DisplayEndReason } from './copy.ts';

const reasons: DisplayEndReason[] = [
  'done',
  'platform-check',
  'account-mismatch',
  'shape-changed',
  'canary',
  'daily-cap',
  'stopped-by-person',
  'error',
  'size-cap',
  'canary-mismatch',
];
test('every browser-run end reason is a single bilingual terminal line with a window-closing instruction', () => {
  const seenEn = new Set<string>(),
    seenDe = new Set<string>();
  for (const reason of reasons) {
    const en = endText(reason),
      de = endText(reason, 'de');
    expect(en).toContain('Close the X window to finish.');
    expect(de).toContain('Schließe das X-Fenster');
    expect(en).not.toMatch(/[\r\n]/);
    expect(de).not.toMatch(/[\r\n]/);
    seenEn.add(en);
    seenDe.add(de);
  }
  expect(seenEn.size).toBe(10);
  expect(seenDe.size).toBe(10);
  expect(endReason('platform-check', { code: 'ACCOUNT_MISMATCH' })).toBe(
    'account-mismatch',
  );
  expect(endReason('error', { code: 'SHAPE_CHANGED' })).toBe('shape-changed');
  expect(endReason(null, undefined)).toBe('error');
  expect(endText('stopped-by-person', 'de')).toContain(
    'Du hast diesen Lauf gestoppt.',
  );
});
