import net from 'node:net';
import type { HttpResult } from './helpers.ts';

/** Gate probe's raw socket transport preserves duplicate and missing headers. */
export function rawBytes(
  port: number,
  bytes: string | Buffer,
): Promise<{ raw: string; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.setTimeout(40_000, () => {
      socket.destroy();
      reject(new Error('Raw probe did not close.'));
    });
    socket.once('connect', () => socket.write(bytes));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () =>
      resolve({
        raw: Buffer.concat(chunks).toString('latin1'),
        elapsedMs: performance.now() - started,
      }),
    );
  });
}

export async function rawRequest(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: [string, string][];
    body?: string;
  } = {},
): Promise<HttpResult> {
  const body = options.body ?? '';
  const lines = [
    `${options.method ?? 'GET'} ${options.path ?? '/'} HTTP/1.1`,
    ...(options.headers ?? []).map(([name, value]) => `${name}: ${value}`),
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ];
  const response = await rawBytes(port, lines.join('\r\n'));
  const split = response.raw.indexOf('\r\n\r\n');
  const head = response.raw.slice(0, split).split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.slice(1)) {
    const index = line.indexOf(':');
    headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  const text = response.raw.slice(split + 4);
  return { status: Number(head[0]!.split(' ')[1]), headers, text, data: null };
}
