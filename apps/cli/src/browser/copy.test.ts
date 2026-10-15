import { expect, test } from 'vitest';
import { endText, endReason } from './copy.ts';
import type { DisplayEndReason } from './copy.ts';
import {
  CliError,
  errorObject,
  PLATFORM_CHECK_REASONS,
  platformCheckReason,
} from '../cli/errors.ts';

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

test('platform-check detail is a closed value-free token and never changes the JSON error envelope', () => {
  for (const reason of PLATFORM_CHECK_REASONS) {
    const error = new CliError('PLATFORM_CHECK', undefined, undefined, reason);
    expect(error.reason).toBe(reason);
    expect(platformCheckReason(reason)).toBe(reason);
    expect(errorObject(error.code, error.nodeVersion, error.details)).toEqual({
      code: 'PLATFORM_CHECK',
      message:
        'The page is not recognized, or shows a login, challenge, lock or limit. The run stopped.',
      exitCode: 1,
      retryable: false,
    });
    expect(
      new CliError('ORIGINALS_FAILED', undefined, undefined, reason).reason,
    ).toBeUndefined();
  }
  for (const value of [
    undefined,
    null,
    'generated_account',
    'render-timeout-extra',
    'MARKER_LOGIN',
    'answer-timeout1',
    'https://example.org/generated',
    { reason: 'render-timeout' },
  ]) {
    expect(platformCheckReason(value)).toBeUndefined();
    expect(
      new CliError('PLATFORM_CHECK', undefined, undefined, value).reason,
    ).toBeUndefined();
  }
});

test('platform end text describes only the known timeout, marker or unrecognized-page category', () => {
  const timeouts = ['render-timeout', 'answer-timeout', 'body-timeout'];
  const markers = [
    'marker-login',
    'marker-challenge',
    'marker-locked',
    'marker-rate-limit',
    'notice-text',
  ];
  for (const lang of ['en', 'de'] as const) {
    for (const reason of [
      ...PLATFORM_CHECK_REASONS,
      undefined,
      'generated account value',
    ]) {
      const text = endText('platform-check', lang, reason, {
        readback: 'unchanged',
      });
      const expected = timeouts.includes(reason ?? '')
        ? lang === 'de'
          ? 'X hat die Seite nicht rechtzeitig geladen. Es wurde nichts geändert.'
          : 'X did not load the page in time. Nothing was changed.'
        : markers.includes(reason ?? '')
          ? lang === 'de'
            ? 'X zeigt eine Seite zum Anmelden, eine Kontoprüfung, eine Sperre oder ein Limit.'
            : 'X shows a sign-in, account check, lock or limit page.'
          : reason === 'extensions-changed'
            ? lang === 'de'
              ? 'Die Erweiterungen des Browserprofils haben sich während des Laufs geändert.'
              : "The browser profile's extensions changed during the run."
            : reason === 'account-changed'
              ? lang === 'de'
                ? 'Das angemeldete Konto hat sich während des Laufs geändert.'
                : 'The signed-in account changed during the run.'
              : reason === 'account-handle'
                ? lang === 'de'
                  ? 'Das angemeldete Konto konnte nach dem Lauf nicht geprüft werden.'
                  : 'The signed-in account could not be read back after the run.'
                : reason === 'account-readback'
                  ? lang === 'de'
                    ? 'Die Kontrolle von Konto und Erweiterungen nach dem Lauf konnte nicht abgeschlossen werden.'
                    : 'The post-run account and extension check could not finish.'
                  : reason === undefined ||
                      reason === 'unspecified' ||
                      reason === 'generated account value'
                    ? lang === 'de'
                      ? 'Die Seite wurde nicht erkannt oder X verlangt eine Kontoprüfung.'
                      : 'The page was not recognized, or X requires an account check.'
                    : lang === 'de'
                      ? 'Die Seite wurde nicht erkannt.'
                      : 'The page was not recognized.';
      expect(text).toContain(expected);
      expect(text).not.toContain('generated account value');
      expect(text).not.toMatch(/[\r\n]/);
      if (
        !markers.includes(reason ?? '') &&
        reason !== undefined &&
        reason !== 'unspecified' &&
        reason !== 'generated account value'
      )
        expect(text).not.toContain(
          lang === 'de' ? 'Kontoprüfung' : 'account check',
        );
      expect(endText('shape-changed', lang, reason)).toBe(
        endText('shape-changed', lang),
      );
    }
  }
});

test('R2 failed or changed read-back wins over timeout or mismatch while unchanged proof alone permits the unchanged sentence', () => {
  for (const lang of ['en', 'de'] as const) {
    const timeout = endText('platform-check', lang, 'render-timeout', {
      readback: 'unchanged',
    });
    expect(timeout).toContain(
      lang === 'de' ? 'Es wurde nichts geändert.' : 'Nothing was changed.',
    );
    for (const readback of [
      'account-readback',
      'account-handle',
      'account-changed',
      'extensions-changed',
    ] as const) {
      for (const reason of [
        'platform-check',
        'canary-mismatch',
        'error',
      ] as const) {
        const text = endText(reason, lang, 'render-timeout', {
          readback,
          canary: false,
        });
        expect(text).toBe(endText('platform-check', lang, readback));
        expect(text).not.toContain(
          lang === 'de' ? 'Es wurde nichts geändert.' : 'Nothing was changed.',
        );
        expect(text).not.toContain(
          lang === 'de' ? 'nicht erkannt' : 'not recognized',
        );
      }
    }
    const main = endText('canary-mismatch', lang, undefined, {
      canary: false,
      readback: 'unchanged',
    });
    expect(main).not.toContain(lang === 'de' ? 'Stichprobe' : 'sample');
    expect(
      endText('canary-mismatch', lang, undefined, { canary: true }),
    ).toContain(lang === 'de' ? 'Stichprobe' : 'sample');
  }
});

test('R2 a timeout without completed read-back cannot claim that nothing changed', () => {
  for (const lang of ['en', 'de'] as const) {
    const text = endText('platform-check', lang, 'render-timeout');
    expect(text).not.toContain(
      lang === 'de' ? 'Es wurde nichts geändert.' : 'Nothing was changed.',
    );
  }
});
test('R2 deletion callers without a detail retain the two-part platform sentence', () => {
  expect(endText('platform-check')).toContain(
    'The page was not recognized, or X requires an account check.',
  );
  expect(endText('platform-check', 'de', 'unspecified')).toContain(
    'Die Seite wurde nicht erkannt oder X verlangt eine Kontoprüfung.',
  );
});
