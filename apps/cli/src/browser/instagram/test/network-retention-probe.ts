import { EventEmitter } from 'node:events';
import type { BrowserContext, Response } from 'playwright-core';
import { guardInstagramNetwork } from '../network.ts';

const context = new EventEmitter() as EventEmitter & {
  route(): Promise<void>;
  routeWebSocket(): Promise<void>;
};
context.route = async () => {};
context.routeWebSocket = async () => {};
const network = await guardInstagramNetwork(
  context as unknown as BrowserContext,
  '',
  async () => {},
  { platform: () => true, image: () => false },
);
let routeHandler: ((route: unknown) => Promise<void>) | undefined;
const routedContext = new EventEmitter() as typeof context;
routedContext.route = async (_pattern?: unknown, handler?: unknown) => {
  await Promise.resolve();
  routeHandler = handler as typeof routeHandler;
};
routedContext.routeWebSocket = async () => {};
const routedNetwork = await guardInstagramNetwork(
  routedContext as unknown as BrowserContext,
  '',
  async () => {},
  { platform: () => true, image: () => false },
);
const refs: WeakRef<Buffer>[] = [];
async function receive() {
  const bytes = Buffer.alloc(256 * 1024, 32);
  bytes[0] = 123;
  bytes[bytes.length - 1] = 125;
  refs.push(new WeakRef(bytes));
  const request = {
    url: () => 'https://www.instagram.com/api/v1/generated/',
    resourceType: () => 'fetch',
    response: () => Promise.resolve(response),
    frame: () => ({ page: () => ({}) }),
    headers: () => ({}),
    method: () => 'POST',
  };
  const response = {
    request: () => request,
    url: request.url,
    status: () => 200,
    headers: () => ({
      'content-type': 'application/json',
      'content-length': String(bytes.length),
    }),
    body: () => Promise.resolve(bytes),
  } as unknown as Response;
  context.emit('response', response);
  await routeHandler!({
    request: () => request,
    continue: () => Promise.resolve(),
    abort: () => Promise.resolve(),
  });
  routedContext.emit('response', response);
}
async function retained() {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
  }
  return refs.filter((ref) => ref.deref()).length;
}
for (let group = 0; group < 10; group++) {
  for (let i = 0; i < 20; i++) await receive();
  await network.flush();
  await routedNetwork.flush();
}
const afterResponses = await retained();
network.dispose();
routedNetwork.dispose();
const afterDispose = await retained();
console.log(
  JSON.stringify({ responses: refs.length, afterResponses, afterDispose }),
);
