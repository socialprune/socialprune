import { expect, test } from 'vitest';
import { parseReplyScripts, scriptReplySource } from './replies-script.ts';
import { checkedReplyRows, combinedReplyAnswer } from './replies-answer.ts';
const match = {
  id: '123',
  username: 'generated_person',
  text: 'Generated text',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const focal = {
  pk: match.id,
  user: { username: match.username },
  text: match.text,
  created_at: Date.parse(match.createdAt) / 1000,
  child_comment_count: 0,
};
test('REPLY-SRC-1 only inert inline application/json scripts parse, no evaluation or external scripts', () => {
  const encoded = JSON.stringify(focal);
  const parsed = parseReplyScripts(
    `<script type="application/json">${encoded}</script><script type=application/json>${encoded}</script><script type="application/json" src="/generated">${encoded}</script><script data-type="application/json">${encoded}</script><script>globalThis.generatedReplyInjection=true</script>`,
  );
  expect(parsed.values).toEqual([focal, focal]);
  expect(Reflect.get(globalThis, 'generatedReplyInjection')).toBeUndefined();
  expect(
    parseReplyScripts('<script type="application/json">{invalid}</script>')
      .failed,
  ).toBe(true);
});
test.each([
  'comment',
  'textarea',
  'style',
  'template',
  'attribute',
  'executable',
] as const)(
  'REPLY-SRC-1 script-looking data inside %s cannot supply an object',
  (container) => {
    const script = `<script type="application/json">${JSON.stringify(focal)}</script>`;
    const html =
      container === 'comment'
        ? `<!--${script}-->`
        : container === 'attribute'
          ? `<div data-generated='${script}'>Generated</div>`
          : container === 'executable'
            ? `<script>const generated=${JSON.stringify(script)};</script>`
            : `<${container}>${script}</${container}>`;
    expect(parseReplyScripts(html).values).toEqual([]);
  },
);
test('REPLY-SRC-1 contradictory exact parent counts and count/list disagreement refuse', () => {
  expect(
    checkedReplyRows([], match, [], false, 0, [
      focal,
      { ...focal, child_comment_count: 1 },
    ]),
  ).toEqual({ reason: 'reply-answer-conflict' });
  expect(
    checkedReplyRows([], match, [], false, 0, [
      {
        ...focal,
        child_comments: [
          {
            pk: '456',
            user: { username: 'generated_child' },
            text: 'Generated child',
            created_at: focal.created_at,
          },
        ],
      },
    ]),
  ).toEqual({ reason: 'reply-answer-conflict' });
});
test.each(['id', 'author', 'time', 'text'] as const)(
  'REPLY-SRC-1 closed %s failure count cannot qualify that object',
  (key) => {
    const value = {
      ...focal,
      ...(key === 'id'
        ? { pk: '999' }
        : key === 'author'
          ? { user: { username: 'generated_other' } }
          : key === 'time'
            ? { created_at: focal.created_at + 1 }
            : { text: 'Generated other' }),
    };
    const result = scriptReplySource([value], match);
    expect(result.objects).toEqual([]);
    expect(result.diagnostic.failedChecks[key]).toBe(1);
    expect(JSON.stringify(result.diagnostic)).not.toContain('generated_person');
  },
);
test('REPLY-SRC-1 exact four checks cannot be assembled across objects or read from parameters/standalone children', () => {
  for (const key of [
    'variables',
    'params',
    'instanceParams',
    'route_match_infos',
  ]) {
    expect(scriptReplySource([{ [key]: focal }], match).objects).toEqual([]);
  }
  expect(
    checkedReplyRows([], match, [], false, 0, [
      { pk: match.id },
      { ...focal, pk: '999' },
      { parent_comment_id: match.id },
    ]),
  ).toEqual({ reason: 'reply-answer-absent' });
});
test('REPLY-SRC-1 network priority never borrows script child rows, and conflicting script counts/rows refuse', () => {
  const child = {
    pk: '456',
    user: { username: 'generated_child' },
    text: 'Generated child',
    created_at: focal.created_at,
    comment_like_count: 1,
  };
  const full = { ...focal, child_comment_count: 1, child_comments: [child] };
  expect(combinedReplyAnswer([full], match, [focal]).source).toBe('conflict');
  expect(
    combinedReplyAnswer([full], match, [
      {
        ...full,
        child_comments: [{ ...child, text: 'Generated changed child' }],
      },
    ]).source,
  ).toBe('conflict');
  expect(
    combinedReplyAnswer([{ ...full, child_comments: [] }], match, [full]).answer
      .entries,
  ).toEqual([]);
  expect(combinedReplyAnswer([full], match, [full]).source).toBe('network');
});
