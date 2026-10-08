import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { HttpReviewRequestSchema } from '@socialprune/core/workspace/protocol';
import { ReviewSession, launchUrl } from './session.ts';
import { REVIEW_HEADERS, staticAssets } from './static.ts';
import { ReviewDatabase } from './database.ts';
import { CliError } from '../cli/errors.ts';
import { workspacePath } from '../workspace/files.ts';

const bodyLimit = 1024 * 1024;
const apiTypes = new Set<string>(
  HttpReviewRequestSchema.options.map((schema) => schema.shape.type.value),
);
function header(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]!.toLowerCase() === name)
      values.push(request.rawHeaders[index + 1]!);
  return values.length === 1 ? values[0] : undefined;
}
function respond(
  response: ServerResponse,
  status: number,
  data?: unknown,
): void {
  response.writeHead(status, {
    ...REVIEW_HEADERS,
    'Content-Type': 'application/json',
  });
  response.end(data === undefined ? undefined : JSON.stringify(data));
}
async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const length = header(request, 'content-length');
  const declaredTooLarge = length !== undefined && Number(length) > bodyLimit;
  return new Promise((resolve, reject) => {
    let size = 0,
      settled = declaredTooLarge;
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => {
      if (settled) return;
      size += part.byteLength;
      if (size > bodyLimit) {
        settled = true;
        parts.length = 0;
      } else parts.push(part);
    });
    request.once('end', () => {
      resolve(settled ? null : Buffer.concat(parts));
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new CliError('CANCELLED')));
  });
}

export async function startReviewServer(options: {
  workspace: string;
  assetDirectory: string;
  signal?: AbortSignal;
  now?: () => number;
  handleSignals?: boolean;
  openDatabase?: typeof ReviewDatabase.open;
}) {
  const assets = await staticAssets(options.assetDirectory);
  const target = await workspacePath(options.workspace, false);
  const database = await (options.openDatabase ?? ReviewDatabase.open)(
    target.path,
  );
  const session = new ReviewSession(options.now);
  let authority = '';
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pending = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const server = createServer(
    {
      headersTimeout: 10_000,
      requestTimeout: 30_000,
      keepAliveTimeout: 5_000,
      requireHostHeader: false,
      connectionsCheckingInterval: 1_000,
    },
    (request, response) => {
      const task = route(request, response)
        .then(async () => {
          if (!response.writableFinished && !response.destroyed)
            await new Promise<void>((resolve) => {
              response.once('finish', () => resolve());
              response.once('close', () => resolve());
            });
        })
        .catch(() => {
          if (!response.headersSent && !response.destroyed)
            respond(response, 500, { code: 'STORAGE' });
          else response.end();
        });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
  );
  server.on('checkExpectation', (request, response) => {
    response.writeHead(417, { ...REVIEW_HEADERS, 'Content-Length': 0 });
    response.end();
    request.resume();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  // Parser failures carry the same policy and never echo a header or URL.
  server.on('clientError', (_error, socket) => {
    if (!socket.writable) return;
    socket.end(
      'HTTP/1.1 400 Bad Request\r\n' +
        Object.entries(REVIEW_HEADERS)
          .map(([name, value]) => `${name}: ${value}\r\n`)
          .join('') +
        'Connection: close\r\nContent-Length: 0\r\n\r\n',
    );
  });
  async function route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (header(request, 'host') !== authority) {
      respond(response, 403);
      request.resume();
      return;
    }
    const path = (request.url ?? '').split('?', 1)[0]!;
    const api = path.startsWith('/api/');
    const sessionPath = path === '/session';
    if (request.method === 'OPTIONS') {
      respond(response, 403);
      request.resume();
      return;
    }
    if (
      api || sessionPath
        ? request.method !== 'POST'
        : !['GET', 'HEAD'].includes(request.method ?? '')
    ) {
      respond(response, 405);
      request.resume();
      return;
    }
    const origin = header(request, 'origin');
    if (
      (api ||
        sessionPath ||
        request.rawHeaders.some(
          (name, index) => index % 2 === 0 && name.toLowerCase() === 'origin',
        )) &&
      origin !== `http://${authority}`
    ) {
      respond(response, 403);
      request.resume();
      return;
    }
    if (!api && !sessionPath) {
      const asset = assets.get(path);
      if (!asset) {
        respond(response, 404);
        return;
      }
      response.writeHead(200, {
        ...REVIEW_HEADERS,
        'Content-Type': asset.contentType,
        'Content-Length': asset.bytes.byteLength,
      });
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
      return;
    }
    if (header(request, 'content-type') !== 'application/json') {
      respond(response, 415);
      request.resume();
      return;
    }
    const body = await readBody(request);
    if (body === null) {
      respond(response, 413);
      return;
    }
    if (
      sessionPath &&
      !session.canExchange(header(request, 'x-socialprune-bootstrap'))
    ) {
      respond(response, 401);
      return;
    }
    if (api && !session.authenticated(header(request, 'cookie'))) {
      respond(response, 401);
      return;
    }
    if (api && !session.authorized(header(request, 'x-socialprune-csrf'))) {
      respond(response, 403);
      return;
    }
    const type = path.slice('/api/'.length);
    if (api && !apiTypes.has(type)) {
      respond(response, 404);
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(body),
      );
    } catch {
      respond(response, 400);
      return;
    }
    if (sessionPath) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      ) {
        respond(response, 400);
        return;
      }
      const result = session.exchange(
        header(request, 'x-socialprune-bootstrap'),
      );
      if (!result) {
        respond(response, 401);
        return;
      }
      response.setHeader('Set-Cookie', result.cookie);
      respond(response, 200, { csrf: result.csrf });
      return;
    }
    const parsed = HttpReviewRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.type !== type) {
      respond(response, 400);
      return;
    }
    if (stopping) {
      respond(response, 401);
      return;
    }
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', abort);
    try {
      const replies = await database.run(parsed.data, controller.signal);
      respond(response, 200, replies);
      if (parsed.data.type === 'shutdown')
        queueMicrotask(() => {
          void stop();
        });
    } finally {
      response.removeListener('close', abort);
    }
  }
  const stopSignal = () => {
    void stop();
  };
  async function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopping = true;
    session.invalidate();
    stopPromise = (async () => {
      const noConnections = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeIdleConnections();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finished = await Promise.race([
        Promise.all([...pending]).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (finished) await database.close();
      else await database.terminate();
      for (const socket of sockets) socket.destroy();
      await noConnections;
      options.signal?.removeEventListener('abort', stopSignal);
      if (options.handleSignals !== false) {
        process.removeListener('SIGINT', stopSignal);
        process.removeListener('SIGTERM', stopSignal);
      }
      finish();
    })();
    return stopPromise;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new CliError('REVIEW_FAILED');
    authority = `127.0.0.1:${address.port}`;
    options.signal?.addEventListener('abort', stopSignal, { once: true });
    if (options.handleSignals !== false) {
      process.on('SIGINT', stopSignal);
      process.on('SIGTERM', stopSignal);
    }
    if (options.signal?.aborted) await stop();
    return {
      url: `http://${authority}/`,
      launchUrl: launchUrl(address.port, session.bootstrap),
      summary: database.summary,
      closed,
      stop,
      address,
      timeouts: {
        headers: server.headersTimeout,
        request: server.requestTimeout,
        keepAlive: server.keepAliveTimeout,
      },
    };
  } catch (error) {
    await database.terminate();
    server.close();
    throw error;
  }
}
