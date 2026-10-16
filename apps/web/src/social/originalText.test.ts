import { expect, test } from 'vitest';
import { OriginalSchema } from '@socialprune/core';
import {
  generatedOriginal,
  originalTextCases,
  originalTextInput,
} from '../../e2e/original-text-fixture.ts';
import { originalDisplayText } from './originalText.ts';

test.each(originalTextCases())('$name without changing stored bytes', (row) => {
  const original = OriginalSchema.parse(row.original);
  const before = JSON.stringify(original);
  expect(originalDisplayText(original)).toBe(row.expected);
  for (const forbidden of row.hidden)
    expect(originalDisplayText(original)).not.toContain(forbidden);
  expect(JSON.stringify(original)).toBe(before);
});

test('preserves other entities, null and already literal markup as text', () => {
  for (const text of [
    null,
    '',
    '<b>literal</b>',
    originalTextInput.otherEntities,
  ])
    expect(originalDisplayText(generatedOriginal({ text }))).toBe(text);
});

test.each(
  [
    null,
    [],
    [0],
    [0, 1, 2],
    [-1, 3],
    [3, 2],
    [0, 9999],
    [0, 2.5],
    ['0', '3'],
  ].map((range) => ({ range })),
)('ignores an invalid display range $range', ({ range }) => {
  const text = originalTextInput.prefix + originalTextInput.body;
  expect(
    originalDisplayText(
      generatedOriginal({ text, raw: { text, display_text_range: range } }),
    ),
  ).toBe(originalTextInput.prefix + originalTextInput.decodedBody);
});

test('does not use mismatched raw text or infer hidden mentions from a parent ID', () => {
  const text = `${originalTextInput.prefix}${originalTextInput.body} ${originalTextInput.mediaLink}`;
  expect(
    originalDisplayText(
      generatedOriginal({
        text,
        parentId: '81000',
        raw: {
          text: 'Generated older text',
          display_text_range: [0, 2],
          entities: { media: [{ url: originalTextInput.mediaLink }] },
        },
      }),
    ),
  ).toBe(
    `${originalTextInput.prefix}${originalTextInput.decodedBody} ${originalTextInput.mediaLink}`,
  );
});

test.each(['media', 'extended', 'details', 'quote'])(
  'reads stored %s link metadata only at the trailing boundary',
  (source) => {
    const input = originalTextInput;
    const text = `${input.mediaLink} ${input.body} ${input.mediaLink}  `;
    const media = [{ url: input.mediaLink }];
    const raw = {
      text,
      ...(source === 'media'
        ? { entities: { media } }
        : source === 'extended'
          ? { extended_entities: { media } }
          : source === 'details'
            ? { mediaDetails: media }
            : {
                quoted_status_permalink: {
                  url: input.mediaLink,
                  expanded: `https://twitter.com/generated/status/${input.quotedId}`,
                },
              }),
    };
    expect(
      originalDisplayText(
        generatedOriginal({ text, raw, quotedId: input.quotedId }),
      ),
    ).toBe(`${input.mediaLink} ${input.decodedBody}`);
  },
);

test('a quote ID, a media count, and ordinary URL entities do not prove hidden text', () => {
  const input = originalTextInput;
  const text = `${input.prefix}${input.body} ${input.unrelatedLink}`;
  for (const expanded_url of [
    `https://x.com/generated/status/${input.quotedId}0`,
    `https://x.com.evil.invalid/generated/status/${input.quotedId}`,
    `https://example.invalid/generated/status/${input.quotedId}`,
    `https://x.com/generated/status/${input.quotedId}?other=1`,
    `https://user@x.com/generated/status/${input.quotedId}`,
    'not a URL',
  ]) {
    const raw = {
      text,
      entities: { urls: [{ url: input.unrelatedLink, expanded_url }] },
      mediaDetails: [
        { media_url_https: 'https://pbs.twimg.com/generated.jpg' },
      ],
    };
    expect(
      originalDisplayText(
        generatedOriginal({
          text,
          raw,
          quotedId: input.quotedId,
          parentId: '81000',
        }),
      ),
    ).toBe(`${input.prefix}${input.decodedBody} ${input.unrelatedLink}`);
  }
});

test('metadata for another original and short-link substrings do not hide text', () => {
  const input = originalTextInput;
  for (const [text, id_str] of [
    [`${input.body} ${input.mediaLink}`, '81099'],
    [`${input.body} prefix${input.mediaLink}`, '81001'],
    [`${input.body} ${input.mediaLink}Extra`, '81001'],
    [`${input.body} ${input.mediaLink}/path`, '81001'],
  ] as const) {
    const raw = {
      text,
      id_str,
      entities: { media: [{ url: input.mediaLink }] },
    };
    expect(originalDisplayText(generatedOriginal({ text, raw }))).toBe(
      text.replace(input.body, input.decodedBody),
    );
  }
});

test('a code-point range preserves astral characters and an explicitly empty display', () => {
  const text = 'A\u{1f600}B &amp;';
  expect(
    originalDisplayText(
      generatedOriginal({ text, raw: { text, display_text_range: [1, 2] } }),
    ),
  ).toBe('\u{1f600}');
  expect(
    originalDisplayText(
      generatedOriginal({ text, raw: { text, display_text_range: [0, 0] } }),
    ),
  ).toBe('');
});

test('fixture oracle rejects heuristic stripping without stored proof (LL-002)', () => {
  const row = originalTextCases()[1]!;
  const assertPreserved = (project: typeof originalDisplayText) =>
    expect(project(row.original)).toBe(row.expected);
  // Planted over-stripping exists only here, never on a production route.
  const heuristic: typeof originalDisplayText = () =>
    originalTextInput.decodedBody;
  expect(() => assertPreserved(heuristic)).toThrow();
  expect(() => assertPreserved(originalDisplayText)).not.toThrow();
});
