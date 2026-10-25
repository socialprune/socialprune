import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';

/** Generated endpoint. Delayed answers keep real sockets observable on Windows. */
export async function scanEndpoint(
  // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener port, never credentials.
  port = Number(process.env['SP_SCAN_TEST_PORT'] ?? '0'),
) {
  const requests: {
    path: string;
    authorization: string | undefined;
    texts: string[];
    at: number;
    peerPort: number;
  }[] = [];
  const held = new Set<ServerResponse>();
  const answers = new Map<ServerResponse, () => void>();
  const peers = new Set<number>();
  let hold = false;
  let redirect: string | null = null;
  let hostile = false;
  const server = createServer((request, response) => {
    peers.add(request.socket.remotePort!);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as {
            messages: { content: string }[];
          })
        : null;
      const entries = body
        ? (JSON.parse(
            body.messages[1]!.content.split('\nValidation failures:')[0]!,
          ) as { id: string; text: string }[])
        : [];
      requests.push({
        path: request.url!,
        authorization: request.headers.authorization,
        texts: entries.map((entry) => entry.text),
        at: Date.now(),
        peerPort: request.socket.remotePort!,
      });
      const answer = () => {
        if (redirect) {
          response.writeHead(302, { Location: redirect });
          response.end('Generated redirect');
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (
          hostile &&
          entries.some((entry) => entry.text.startsWith('Generated packaged'))
        ) {
          response.writeHead(401);
          response.end(
            JSON.stringify({
              echo: entries.map((entry) => entry.text),
              authorization: request.headers.authorization,
            }),
          );
          return;
        }
        response.end(
          JSON.stringify(
            request.url?.endsWith('/models')
              ? { data: [{ id: 'generated-model' }] }
              : {
                  model: 'generated-model',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: JSON.stringify({
                          results: entries.map(({ id }) => ({
                            id,
                            labels: [],
                          })),
                        }),
                      },
                    },
                  ],
                  usage: { prompt_tokens: 100, completion_tokens: 10 },
                },
          ),
        );
      };
      if (
        hold &&
        entries.some((entry) => entry.text.startsWith('Generated packaged'))
      ) {
        held.add(response);
        answers.set(response, answer);
        response.once('close', () => {
          held.delete(response);
          answers.delete(response);
        });
      } else {
        const timer = setTimeout(answer, 750);
        response.once('close', () => clearTimeout(timer));
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  );
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    peers,
    held,
    release() {
      for (const answer of answers.values()) answer();
    },
    setHold(value: boolean) {
      hold = value;
    },
    setHostile(value: boolean) {
      hostile = value;
    },
    setRedirect(value: string | null) {
      redirect = value;
    },
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
