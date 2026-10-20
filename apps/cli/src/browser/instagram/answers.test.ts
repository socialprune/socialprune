import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import type { Page, Request } from 'playwright-core';
import { pageAnswers } from './capture.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

const code = IG_FIXTURE.code;
const post = {
  code,
  user: { username: IG_FIXTURE.other.username },
  caption: { text: IG_FIXTURE.other.text },
};
const head = { data: null, hasNext: true };
const deferred = {
  label: IG_FIXTURE.other.text,
  path: ['items', 0],
  data: { items: [post] },
};
function collector() {
  const page = new EventEmitter();
  const answers = pageAnswers(page as unknown as Page, {
    platform: (url) => url.startsWith('https://www.instagram.com/'),
    image: () => false,
  });
  answers.reset(true);
  const send = (
    input: string | Buffer,
    options: {
      type?: string;
      status?: number;
      url?: string;
      declared?: number;
      body?: () => Promise<Buffer>;
    } = {},
  ) => {
    const request = {} as Request;
    page.emit('request', request);
    page.emit('response', {
      request: () => request,
      status: () => options.status ?? 200,
      url: () => options.url ?? 'https://www.instagram.com/ajax/generated',
      headers: () => ({
        'content-type': options.type ?? 'application/json',
        'content-length': String(options.declared ?? Buffer.byteLength(input)),
      }),
      body: options.body ?? (() => Promise.resolve(Buffer.from(input))),
    });
  };
  return { answers, send };
}

test.each([
  ['newline', JSON.stringify(head) + '\n' + JSON.stringify(deferred)],
  ['concatenated', JSON.stringify(head) + JSON.stringify(deferred)],
  [
    'escaped',
    JSON.stringify({ text: 'Generated } { [ ] " \\ \n control' }) +
      JSON.stringify(deferred),
  ],
] as const)(
  'C14 %s answers keep the second deferred document independently',
  async (_name, text) => {
    const h = collector();
    h.send(text);
    await h.answers.flush(1000);
    expect(h.answers.bodies).toHaveLength(2);
    expect(h.answers.bodies[1]).toEqual(deferred);
    h.answers.dispose();
  },
);
test.each([
  'application/json; charset=utf-8',
  'text/javascript; charset=utf-8',
])('C14 %s accepts the optional for prefix as data only', async (type) => {
  const h = collector();
  h.send(' for (;;); ' + JSON.stringify(deferred), { type });
  await h.answers.flush(1000);
  expect(h.answers.bodies).toEqual([deferred]);
  h.answers.dispose();
});
test('C14 incremental items and shortcode documents are not merged or discarded', async () => {
  const other = {
    path: ['items', 0],
    items: [{ ...post, code: undefined, shortcode: code }],
  };
  const h = collector();
  h.send(JSON.stringify(deferred) + JSON.stringify(other));
  await h.answers.flush(1000);
  expect(h.answers.bodies).toEqual([
    deferred,
    JSON.parse(JSON.stringify(other)),
  ]);
  h.answers.dispose();
});
test.each([
  '{"data":',
  JSON.stringify(deferred) + 'garbage',
  JSON.stringify(deferred) + '{"data":',
  'for (;;); globalThis.__c14Injected = true;',
  '[{"data":1}',
  '{"caption":"unterminated}',
])(
  'C14 malformed or executable input refuses the whole response %s',
  async (text) => {
    const h = collector();
    h.send(text);
    await h.answers.flush(1000);
    expect(h.answers.bodies).toEqual([]);
    expect(Reflect.get(globalThis, '__c14Injected')).toBeUndefined();
    h.answers.dispose();
  },
);
test('C14 ignores foreign hosts, non-200 answers and unapproved content types', async () => {
  const h = collector(),
    text = JSON.stringify(deferred);
  h.send(text, { url: 'https://foreign.invalid/ajax/generated' });
  h.send(text, { status: 201 });
  h.send(text, { type: 'text/html' });
  await h.answers.flush(1000);
  expect(h.answers.bodies).toEqual([]);
  h.answers.dispose();
});
test('C14 keeps per-response 5 MiB, aggregate 50 MiB and generation limits', async () => {
  const h = collector();
  const large = JSON.stringify({ code, padding: 'x'.repeat(5 * 1024 ** 2) });
  h.send(large);
  h.send(JSON.stringify(post), { declared: 5 * 1024 ** 2 + 1 });
  const body = JSON.stringify({
    code,
    padding: 'x'.repeat(5 * 1024 ** 2 - 100),
  });
  for (let i = 0; i < 11; i++) h.send(body);
  await h.answers.flush(1000);
  expect(h.answers.bodies).toHaveLength(10);
  let release!: (bytes: Buffer) => void;
  h.send('', {
    body: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  h.answers.reset(true);
  release(Buffer.from(JSON.stringify(post)));
  await h.answers.flush(1000);
  expect(h.answers.bodies).toEqual([]);
  h.answers.dispose();
});
test('C14 parser diagnostics count failed and code-bearing responses without their values', async () => {
  const h = collector();
  h.send(JSON.stringify(head) + '\n' + JSON.stringify(deferred));
  h.send('for (;;);' + JSON.stringify(post), { type: 'text/javascript' });
  h.send('{"code":"' + code + '",');
  await h.answers.flush(1000);
  const summary = h.answers.summary(code);
  expect(summary).toMatchObject({
    contentTypes: {
      json: {
        responses: 2,
        bodies: 2,
        single: 0,
        sequence: 1,
        failed: 1,
        responsesWithCode: 2,
      },
      javascript: {
        responses: 1,
        bodies: 1,
        single: 1,
        sequence: 0,
        failed: 0,
        responsesWithCode: 1,
      },
    },
  });
  expect(summary.objects[0]).toMatchObject({
    path: 'data.items[]',
    keys: ['caption', 'code', 'user'],
    fields: { owner: true, time: false, caption: true, image: false },
  });
  for (const value of [code, ...Object.values(IG_FIXTURE.other)])
    expect(JSON.stringify(summary)).not.toContain(value);
  h.answers.dispose();
});
test('C14 diagnostic object paths and sorted keys redact fixture values and cap traversal', async () => {
  const h = collector();
  h.send(
    JSON.stringify({
      [IG_FIXTURE.other.username]: {
        [IG_FIXTURE.other.code]: Array.from({ length: 70 }, () => ({
          ...post,
          [IG_FIXTURE.other.text]: IG_FIXTURE.other.time,
        })),
      },
    }),
  );
  await h.answers.flush(1000);
  const summary = h.answers.summary(code);
  expect(summary.objects).toHaveLength(64);
  expect(summary.objectsCapped).toBe(true);
  expect(summary.objects[0]).toMatchObject({
    path: '*.*[]',
    keys: ['*', 'caption', 'code', 'user'],
  });
  for (const value of [code, ...Object.values(IG_FIXTURE.other)])
    expect(JSON.stringify(summary)).not.toContain(value);
  h.answers.dispose();
});
test.each(['['.repeat(130) + '0' + ']'.repeat(130) + '{}', '{}'.repeat(4097)])(
  'C14 sequence scanner bounds nesting and document count',
  async (text) => {
    const h = collector();
    h.send(text);
    await h.answers.flush(1000);
    expect(h.answers.bodies).toEqual([]);
    h.answers.dispose();
  },
);
test('C14 body read failures and invalid UTF-8 remain counted without exceptions', async () => {
  const h = collector();
  h.send('', { body: () => Promise.reject(new Error(IG_FIXTURE.other.text)) });
  h.send(Buffer.from([0xff, 0xfe]));
  await h.answers.flush(1000);
  expect(h.answers.summary(code).contentTypes.json).toMatchObject({
    responses: 2,
    failed: 2,
    bodies: 0,
  });
  expect(JSON.stringify(h.answers.summary(code))).not.toContain(
    IG_FIXTURE.other.text,
  );
  h.answers.reset(false);
  h.send(JSON.stringify(post));
  await h.answers.flush(1000);
  expect(h.answers.bodies).toEqual([]);
  h.answers.dispose();
});
test.each(['null\ntrue\nfalse', '0\n-1\n2.5e3', '"generated \\\" [ ]"{}[]'])(
  'C14 scanner keeps primitive top-level sequence values as separate data %s',
  async (text) => {
    const h = collector();
    h.send(text);
    await h.answers.flush(1000);
    expect(h.answers.bodies).toHaveLength(3);
    h.answers.dispose();
  },
);
