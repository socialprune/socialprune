import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { browserWorkspace } from '../../workspace/test/inputs.ts';
import { startReviewServer } from '../server.ts';
import { WorkspaceReplySchema } from '@socialprune/core/workspace/protocol';
import type { HttpReviewRequest } from '@socialprune/core/workspace/protocol';

export async function inputs(count = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c3-'));
  const assets = join(directory, 'assets');
  const workspace = join(directory, 'workspace');
  await mkdir(assets);
  await mkdir(workspace);
  await mkdir(join(assets, 'assets'));
  await writeFile(
    join(assets, 'index.html'),
    '<!doctype html><title>Generated review test</title>',
  );
  await writeFile(
    join(assets, 'assets', 'app.js'),
    'export const generated = true;',
  );
  await writeFile(join(assets, 'assets', 'app.css'), 'body { color: black; }');
  const initial = browserWorkspace();
  initial.decisionEvents = [];
  initial.outcomeEvents = [];
  initial.assessments = [];
  initial.submissions = [];
  initial.items = Array.from({ length: count }, (_, index) => ({
    ...initial.items[0]!,
    id: `x:${101 + index}`,
    text: `Generated review entry ${index}.`,
    provenance: { ...initial.items[0]!.provenance, index },
  }));
  initial.counts = {
    imports: 1,
    items: count,
    decisionEvents: 0,
    outcomeEvents: 0,
    assessments: 0,
    submissions: 0,
  };
  initial.imports[0]!.itemCount = count;
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial,
  });
  await store.close();
  return {
    directory,
    assets,
    workspace,
    initial,
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  data: unknown;
}
export function request(
  url: string,
  options: {
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const method = options.method ?? 'POST';
    const body = options.body ?? (method === 'POST' ? '{}' : '');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: target.port,
        path: options.path ?? '/',
        method,
        headers: {
          'Content-Length': String(Buffer.byteLength(body)),
          ...options.headers,
        },
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (part: Buffer) => chunks.push(part));
        response.once('error', reject);
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            text,
            data,
          });
        });
      },
    );
    req.once('error', reject);
    req.end(body);
  });
}
export async function running(count = 2, now?: () => number) {
  const data = await inputs(count);
  const server = await startReviewServer({
    workspace: data.workspace,
    assetDirectory: data.assets,
    handleSignals: false,
    now,
  });
  const origin = server.url.slice(0, -1);
  const token = new URL(server.launchUrl).hash.slice('#bootstrap='.length);
  const base = {
    Host: new URL(origin).host,
    Origin: origin,
    'Content-Type': 'application/json',
  };
  const exchange = () =>
    request(origin, {
      path: '/session',
      headers: { ...base, 'X-SocialPrune-Bootstrap': token },
    });
  let cookie = '',
    csrf = '';
  async function authenticate() {
    const response = await exchange();
    cookie = response.headers['set-cookie']![0]!.split(';', 1)[0]!;
    const result = response.data as { csrf: string };
    csrf = result.csrf;
    return response;
  }
  const authHeaders = () => ({
    ...base,
    Cookie: cookie,
    'X-SocialPrune-CSRF': csrf,
  });
  const api = async (input: HttpReviewRequest) => {
    const response = await request(origin, {
      path: `/api/${input.type}`,
      headers: authHeaders(),
      body: JSON.stringify(input),
    });
    return {
      ...response,
      replies: WorkspaceReplySchema.array().parse(response.data),
    };
  };
  return {
    ...data,
    server,
    origin,
    token,
    base,
    exchange,
    authenticate,
    authHeaders,
    api,
    async dispose() {
      await server.stop();
      await data.dispose();
    },
  };
}
