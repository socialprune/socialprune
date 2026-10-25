import { EventEmitter } from 'node:events';
import type { Page, Request, Response } from 'playwright-core';
import { expect, test } from 'vitest';
import { pageAnswers } from './capture.ts';

function response(request: Request, type: string, bytes: Buffer): Response {
  return {
    request: () => request,
    url: () =>
      type === 'image/png'
        ? 'https://cdninstagram.com/generated.png'
        : 'https://www.instagram.com/api/v1/generated/',
    headers: () => ({
      'content-type': type,
      'content-length': String(bytes.length),
    }),
    status: () => 200,
    body: () => Promise.resolve(bytes),
  } as unknown as Response;
}
test('C35 capture disposal releases current image/body references and cannot be repopulated', async () => {
  const page = new EventEmitter();
  const answers = pageAnswers(page as unknown as Page, {
    platform: () => true,
    image: (url) => url.includes('cdninstagram'),
  });
  answers.reset(true);
  const request = {} as Request;
  page.emit('request', request);
  page.emit(
    'response',
    response(request, 'application/json', Buffer.from('{"generated":true}')),
  );
  page.emit(
    'response',
    response(request, 'image/png', Buffer.from([137, 80, 78, 71])),
  );
  await answers.flush(100);
  expect(answers.images.size).toBe(1);
  expect(answers.bodies).toHaveLength(1);
  answers.dispose();
  expect(answers.images.size).toBe(0);
  expect(answers.bodies).toHaveLength(0);
  expect(page.listenerCount('request') + page.listenerCount('response')).toBe(
    0,
  );
});
test('C35 a response started before a reset cannot retain an old-generation image', () => {
  const page = new EventEmitter();
  const answers = pageAnswers(page as unknown as Page, {
    platform: () => true,
    image: () => true,
  });
  answers.reset(true);
  const request = {} as Request;
  page.emit('request', request);
  answers.reset(true);
  page.emit(
    'response',
    response(request, 'image/png', Buffer.from([137, 80, 78, 71])),
  );
  expect(answers.images.size).toBe(0);
  answers.dispose();
});
test('C35 reset and disposal release an unresolved old body wait without accepting its late answer', async () => {
  const page = new EventEmitter();
  const answers = pageAnswers(page as unknown as Page, {
    platform: () => true,
    image: () => false,
  });
  answers.reset(true);
  const request = {} as Request;
  page.emit('request', request);
  let resolveBody!: (value: Buffer) => void;
  const pending = {
    request: () => request,
    url: () => 'https://www.instagram.com/api/v1/generated/',
    headers: () => ({ 'content-type': 'application/json' }),
    status: () => 200,
    body: () =>
      new Promise<Buffer>((resolve) => {
        resolveBody = resolve;
      }),
  } as unknown as Response;
  page.emit('response', pending);
  answers.reset(true);
  await answers.flush(100);
  resolveBody(Buffer.from('{"generated":"late"}'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(answers.bodies).toHaveLength(0);
  expect(answers.summary(null).contentTypes.json.bodies).toBe(0);
  answers.dispose();
});
