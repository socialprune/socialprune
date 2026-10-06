import { expect, test } from 'vitest';
import { parseJsonArrayStream, JsonFormatError } from './index.ts';
import { ArchiveLimitError } from '../archive/index.ts';
async function* chars(text: string) {
  await Promise.resolve();
  for (const character of text) yield character;
}
async function collect(
  text: string,
  assignment: 'none' | 'allowed' = 'allowed',
  maximum?: number,
) {
  const parser = parseJsonArrayStream(chars(text), {
    assignment,
    maxElementBytes: maximum,
  });
  const elements = [];
  for await (const element of parser) elements.push(element);
  return { elements, target: await parser.target };
}
test('element splitting survives strings, escapes, nesting and one-character chunks', async () => {
  const data = [
    {
      text: 'brackets ] [ and "quote" and \\',
      nested: [1, null, { yes: true }],
    },
    '😺',
    123,
    false,
  ];
  expect(
    (await collect('\uFEFF' + JSON.stringify(data), 'none')).elements,
  ).toEqual(data);
  expect(await collect(' [] ; ')).toEqual({ elements: [], target: null });
});
test.each([
  ['window', 'YTD', 'tweets', 'part0'],
  ['Grailbird', 'data', 'tweets_2013_01'],
  ['_$', 'data$'],
])('strict assignment prefix %j', async (...parts) => {
  const target = parts.join('.');
  expect(await collect(`${target} = [1,2];`)).toEqual({
    elements: [1, 2],
    target,
  });
});
test('rejects code, trailing code, multiple assignments, objects and invalid JSON without execution', async () => {
  const target = ['window', 'YTD', 'tweets', 'part0'].join('.');
  const payload = `${target} = (function(){globalThis.__pwned = 1})() || []`;
  const planted = globalThis as typeof globalThis & { __pwned?: unknown };
  expect(planted.__pwned).toBeUndefined();
  for (const input of [
    payload,
    '[]; globalThis.__pwned = 1',
    'a = b = []',
    '{}',
    '[1,]',
    '[,1]',
    '[{"x":1]',
    '["bad\\q"]',
  ])
    await expect(collect(input)).rejects.toBeInstanceOf(JsonFormatError);
  expect(planted.__pwned).toBeUndefined();
  await expect(collect('a = []', 'none')).rejects.toBeInstanceOf(
    JsonFormatError,
  );
});
test('UTF-8 element limits and abort use typed errors', async () => {
  await expect(collect('["😺"]', 'none', 5)).rejects.toBeInstanceOf(
    ArchiveLimitError,
  );
  const controller = new AbortController();
  controller.abort();
  const parser = parseJsonArrayStream(chars('[]'), {
    assignment: 'none',
    signal: controller.signal,
  });
  await expect(parser[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: 'AbortError',
  });
});
test('midstream cancellation does not wait for a stalled chunk producer', async () => {
  let release: () => void = () => {};
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* chunks() {
    yield '[';
    await stalled;
    yield '1]';
  }
  const controller = new AbortController();
  const parser = parseJsonArrayStream(chunks(), {
    assignment: 'none',
    signal: controller.signal,
  });
  const pending = parser[Symbol.asyncIterator]().next();
  await Promise.resolve();
  controller.abort();
  try {
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    release();
  }
});
