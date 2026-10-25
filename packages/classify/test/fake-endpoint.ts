import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SourceConfig } from '../src/config.ts';
import { parseSource } from '../src/config.ts';

export interface RecordedRequest {
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown> | null;
}
export async function fakeEndpoint(
  reply?: (
    input: RecordedRequest,
    index: number,
  ) => { status?: number; body?: unknown; headers?: Record<string, string> },
  port = 0,
) {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
            string,
            unknown
          >)
        : null;
      const input = {
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      };
      requests.push(input);
      const result = reply?.(input, requests.length - 1);
      const entries =
        body && Array.isArray(body.messages)
          ? (JSON.parse(
              (body.messages[1] as { content: string }).content.split(
                '\nValidation failures:',
              )[0]!,
            ) as { id: string }[])
          : [];
      response.writeHead(result?.status ?? 200, {
        'Content-Type': 'application/json',
        ...result?.headers,
      });
      response.end(
        result && 'body' in result
          ? typeof result.body === 'string'
            ? result.body
            : JSON.stringify(result.body)
          : JSON.stringify({
              model: 'generated-model',
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      results: entries.map((entry) => ({
                        id: entry.id,
                        labels: [],
                      })),
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 100 + entries.length,
                prompt_tokens_details: { cached_tokens: 50 },
                completion_tokens: entries.length * 2,
              },
            }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = (overrides: Partial<SourceConfig> = {}) =>
    parseSource({
      schemaVersion: 1,
      name: 'generated',
      baseUrl: origin + '/v1',
      model: 'generated-model',
      entriesPerRequest: 25,
      ...overrides,
    });
  return {
    origin,
    requests,
    config,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
