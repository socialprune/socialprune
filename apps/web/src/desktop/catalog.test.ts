import { expect, test } from 'vitest';
import {
  RunStopDetailSchema,
  RunEndReasonSchema,
  RunJournalOutcomeSchema,
  RunReadbackOutcomeSchema,
  RunActionSchema,
  XPlatformCheckTokenSchema,
  InstagramStopTokenSchema,
  DesktopErrorCodeSchema,
  RunJournalCodeSchema,
} from '@socialprune/core/workspace/desktop-protocol';
import en from '../i18n/en.json';
import de from '../i18n/de.json';
import { tokenMessage } from './messages.ts';

const families = {
  detail: RunStopDetailSchema,
  end: RunEndReasonSchema,
  outcome: RunJournalOutcomeSchema,
  readback: RunReadbackOutcomeSchema,
  action: RunActionSchema,
  xCheck: XPlatformCheckTokenSchema,
  instagramStop: InstagramStopTokenSchema,
  error: DesktopErrorCodeSchema,
  journalCode: RunJournalCodeSchema,
};

function assertSentences(catalog: Record<string, string>) {
  for (const schema of Object.values(families))
    for (const token of schema.options) {
      const id = `desktop.token.${token}`;
      expect(tokenMessage(token)).toBe(id);
      expect(catalog[id], id).toBeTruthy();
      expect(catalog[id], id).toMatch(/[.!?]$/u);
    }
}

test.each([
  ['en', en],
  ['de', de],
] as const)(
  '%s gives every schema token a catalog sentence',
  (_locale, catalog) => assertSentences(catalog),
);

test('a planted missing catalog sentence is rejected', () => {
  const planted: Record<string, string> = { ...en };
  delete planted[`desktop.token.${RunStopDetailSchema.options[0]}`];
  expect(() => assertSentences(planted)).toThrow();
});
