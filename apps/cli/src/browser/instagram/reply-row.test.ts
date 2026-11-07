import { expect, test } from 'vitest';
import type { Locator } from 'playwright-core';
import { readAnswerBoundReply } from './reply-row.ts';
import type { ReplyRowDiagnostic } from './report.ts';
const at = '2025-01-02T12:00:00.000Z';
const answerEntry = {
  id: '900000',
  account: 'generated_reply',
  text: 'Generated\n reply café',
  createdAt: at,
  likes: { count: 7, source: 'answer' as const },
};
function row(
  options: {
    href?: string;
    time?: string;
    profiles?: string[];
    text?: string;
    links?: number;
    times?: number;
  } = {},
) {
  const times = {
    count: () => Promise.resolve(options.times ?? 1),
    getAttribute: () => Promise.resolve(options.time ?? at),
  };
  const links = {
    count: () => Promise.resolve(options.links ?? 1),
    getAttribute: () =>
      Promise.resolve(options.href ?? '/p/Generated/c/900000/'),
    locator: () => times,
  };
  return {
    locator: (selector: string) =>
      selector === 'a[href*="/c/"]'
        ? links
        : selector === 'time[datetime]'
          ? times
          : {
              all: () =>
                Promise.resolve(
                  (
                    options.profiles ?? [
                      '/GENERATED_REPLY/',
                      '/generated_reply/',
                      '/generated_mention/',
                    ]
                  ).map((path) => ({
                    getAttribute: () => Promise.resolve(path),
                  })),
                ),
            },
    innerText: () =>
      Promise.resolve(
        options.text ?? 'generated_reply Generated reply cafe\u0301 999 likes',
      ),
  } as unknown as Locator;
}
test.each([
  'matching',
  'id',
  'duplicate',
  'foreign',
  'missing-time',
  'time',
  'author',
  'text',
  'invalid',
  'absent',
] as const)(
  'ROWANSWER unique entry %s binds visible id time author and text before content leaves answer',
  async (variant) => {
    const diagnostic = {
      extraction: 'none',
      failedStep: 'author',
    } as ReplyRowDiagnostic;
    const entries =
      variant === 'id'
        ? []
        : variant === 'duplicate'
          ? [answerEntry, answerEntry]
          : [answerEntry];
    const answer = {
      present: variant !== 'absent',
      valid: variant !== 'invalid',
      total: 1,
      entries,
    };
    const result = await readAnswerBoundReply(
      row(
        variant === 'foreign'
          ? { href: '/p/Other/c/900000/' }
          : variant === 'missing-time'
            ? { times: 0 }
            : variant === 'time'
              ? { time: '2025-01-02T12:00:00.001Z' }
              : variant === 'author'
                ? { profiles: ['/generated_mention/'] }
                : variant === 'text'
                  ? { text: 'Generated absent text' }
                  : {},
      ),
      { kind: 'p', code: 'Generated' },
      answer,
      diagnostic,
    );
    if (variant === 'matching') {
      expect(result?.answerEntry).toEqual(answerEntry);
      expect(diagnostic).toMatchObject({
        extraction: 'answer',
        failedStep: 'none',
      });
    } else {
      expect(result).toBeNull();
      expect(diagnostic.failedStep).toBe(
        variant === 'time' || variant === 'missing-time'
          ? 'answer-time'
          : variant === 'author'
            ? 'answer-author'
            : variant === 'text'
              ? 'answer-text'
              : 'answer-id',
      );
    }
  },
);
