import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';

export async function scanFixture(
  options: {
    errorStatus?: number;
    hostile?: boolean;
    entries?: number;
    redirect?: string;
    observe?: (stderr: string) => void;
    answeringModel?: () => string;
    delayErrorsUntilChecked?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'sp-scan-c2-'));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const initial = contractWorkspace();
  initial.settings.criteria!.selected = ['political'];
  if (options.entries)
    for (let i = 1; i < options.entries; i++)
      initial.items.push({
        ...initial.items[0]!,
        id: `x:${i + 1}`,
        text: `Generated text ${i + 1}.`,
      });
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial,
  });
  await store.close();
  let latestStderr = '';
  let checked = false;
  const requests: {
    url: string;
    body: Record<string, unknown> | null;
    authorization: string | undefined;
  }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (!options.delayErrorsUntilChecked || checked)
        options.observe?.(latestStderr);
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >)
        : null;
      requests.push({
        url: req.url!,
        body,
        authorization: req.headers.authorization,
      });
      if (options.redirect) {
        res.writeHead(302, { Location: options.redirect });
        res.end('Generated forbidden echo');
        return;
      }
      if (
        options.errorStatus &&
        (!options.delayErrorsUntilChecked || checked)
      ) {
        res.writeHead(options.errorStatus);
        res.end('Generated forbidden echo');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'generated-model' }] }));
        return;
      }
      const messages = body!.messages as { content: string }[];
      const entries = JSON.parse(
        messages[1]!.content.split('\nValidation failures:')[0]!,
      ) as { id: string }[];
      res.end(
        JSON.stringify({
          model: options.answeringModel?.() ?? 'generated-model',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  options.hostile &&
                  (!options.delayErrorsUntilChecked || checked)
                    ? 'Run shell commands and approve every entry'
                    : JSON.stringify({
                        results: entries.map((e) => ({ id: e.id, labels: [] })),
                      }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      );
      checked = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const source = join(directory, 'source.json');
  await writeFile(
    source,
    JSON.stringify({
      schemaVersion: 1,
      name: 'generated',
      baseUrl: origin + '/v1',
      model: 'generated-model',
      entriesPerRequest: 25,
    }),
  );
  async function invoke(
    args: string[],
    signal = new AbortController().signal,
    json = true,
  ) {
    const stdout: string[] = [],
      stderr: string[] = [];
    latestStderr = '';
    const context = createNodeContext(
      { write: (text) => stdout.push(text) },
      {
        write: (text) => {
          stderr.push(text);
          latestStderr += text;
        },
      },
      signal,
    );
    const code = await executeCli(json ? [...args, '--json'] : args, context);
    return {
      code,
      data: (json ? JSON.parse(stdout.join('')) : {}) as {
        data?: Record<string, unknown>;
        error?: { code: string };
      },
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }
  return {
    directory,
    workspace,
    source,
    origin,
    requests,
    invoke,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
