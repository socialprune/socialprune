import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  readFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';
import { loadSource, nodeTransport } from '../src/node.ts';
import { EndpointSource } from '../src/endpoint.ts';
import { fakeEndpoint } from './fake-endpoint.ts';
import { PRESETS } from '@socialprune/core/criteria';

const root = fileURLToPath(new URL('../', import.meta.url));
async function child(
  script: string,
  args: string[],
  env: Record<string, string>,
) {
  const process = spawn(globalThis.process.execPath, [script, ...args], {
    env: { ...globalThis.process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  process.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  process.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    process.on('error', reject);
    process.on('close', resolve);
  });
  return { stdout, stderr, code };
}
test('explicit key files reject tool config, multiline, symlinks and Git paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-classify-key-'));
  const fake = await fakeEndpoint();
  try {
    const source = join(directory, 'source.json');
    const key = join(directory, 'named.key');
    await writeFile(
      source,
      JSON.stringify(fake.config({ keyFile: 'named.key' })),
    );
    for (const text of [
      '',
      'key\nsecond',
      '{"key":"decoy"}',
      'key: decoy',
      'KEY=decoy',
      'key with spaces',
    ]) {
      await writeFile(key, text);
      await expect(loadSource(source)).rejects.toThrow('KEY_FILE_INVALID');
    }
    await writeFile(key, 'generated-secret\r\n');
    expect((await loadSource(source)).key).toBe('generated-secret');
    await mkdir(join(directory, '.git'));
    await expect(loadSource(source)).rejects.toThrow('KEY_FILE_INVALID');
  } finally {
    await fake.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('measurement entrypoint ignores environment keys, decoy home configs and an environment proxy', async () => {
  const fake = await fakeEndpoint();
  const proxy = await fakeEndpoint();
  const directory = await mkdtemp(join(tmpdir(), 'sp-classify-child-'));
  try {
    const source = join(directory, 'source.json');
    await writeFile(source, JSON.stringify(fake.config()));
    await writeFile(
      join(directory, 'other-tool.json'),
      JSON.stringify({ apiKey: 'ENV_KEY_CANARY' }),
    );
    const result = await child(
      join(root, 'scripts/measure-batches.ts'),
      [
        '--source',
        source,
        '--confirm-endpoint',
        fake.origin,
        '--confirm-model',
        'generated-model',
      ],
      {
        OPENAI_API_KEY: 'ENV_KEY_CANARY',
        OPENROUTER_API_KEY: 'ENV_KEY_CANARY',
        ANTHROPIC_API_KEY: 'ENV_KEY_CANARY',
        OLLAMA_API_KEY: 'ENV_KEY_CANARY',
        LLAMA_API_KEY: 'ENV_KEY_CANARY',
        HOME: directory,
        USERPROFILE: directory,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: proxy.origin,
        HTTPS_PROXY: proxy.origin,
        ALL_PROXY: proxy.origin,
        NO_PROXY: '',
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(fake.requests).toHaveLength(160);
    expect(proxy.requests).toHaveLength(0);
    expect(fake.requests.every((r) => r.authorization === undefined)).toBe(
      true,
    );
    expect(JSON.stringify(fake.requests)).not.toContain('ENV_KEY_CANARY');
    expect(result.stdout + result.stderr).not.toContain(
      'Generated batch measurement entry',
    );
    expect(result.stdout).not.toContain('itemId');
    expect(result.stderr).toContain('leave your computer');
    expect(JSON.parse(result.stdout)).toMatchObject({
      generated: true,
      measuredDefault: 50,
    });
  } finally {
    await fake.close();
    await proxy.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test('error output never reflects a key or the endpoint echo; redirects never contact another origin', async () => {
  const foreign = await fakeEndpoint();
  const secret = 'generated-secret-canary';
  const fake = await fakeEndpoint(() => ({
    status: 302,
    headers: { Location: foreign.origin },
    body: secret + ' Generated batch measurement entry',
  }));
  const directory = await mkdtemp(join(tmpdir(), 'sp-classify-error-'));
  try {
    const source = join(directory, 'source.json');
    await writeFile(join(directory, 'named.key'), secret);
    await writeFile(
      source,
      JSON.stringify(fake.config({ keyFile: 'named.key' })),
    );
    const result = await child(
      join(root, 'scripts/measure-batches.ts'),
      [
        '--source',
        source,
        '--confirm-endpoint',
        fake.origin,
        '--confirm-model',
        'generated-model',
      ],
      {},
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('REDIRECT_REFUSED');
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(foreign.requests).toHaveLength(0);
  } finally {
    await fake.close();
    await foreign.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
test.each(['openai-compatible', 'llama-server', 'openrouter'] as const)(
  'profile %s sends only its contracted fields',
  async (profile) => {
    const fake = await fakeEndpoint();
    const transport = nodeTransport(fake.origin);
    try {
      const source = new EndpointSource(
        fake.config({ profile }),
        transport.transport,
      );
      await source.check(
        {
          criteria: PRESETS.filter((c) => c.id === 'political'),
          entries: [
            {
              id: 'e1',
              platform: 'x',
              kind: 'post',
              text: 'Generated example.',
            },
          ],
        },
        new AbortController().signal,
      );
      const body = fake.requests[0]!.body!;
      expect(body.stream).toBe(false);
      const format = body.response_format as {
        schema?: unknown;
        json_schema?: { schema: unknown };
      };
      const schema = (format.schema ?? format.json_schema?.schema) as {
        properties: {
          results: {
            items: {
              properties: {
                id: Record<string, unknown>;
                labels: {
                  items: { properties: { category: { enum: string[] } } };
                };
              };
            };
          };
        };
      };
      // Criterion enums are stable for the group; IDs stay generic across batches.
      expect(schema.properties.results.items.properties.id).not.toHaveProperty(
        'enum',
      );
      expect(
        schema.properties.results.items.properties.labels.items.properties
          .category.enum,
      ).toEqual(['political', 'harmless', 'unclear']);
      if (profile === 'openrouter') {
        expect(body.provider).toMatchObject({
          allow_fallbacks: false,
          max_price: { prompt: 0, completion: 0, request: 0 },
        });
        expect(body.session_id).toEqual(expect.any(String));
      } else expect(body.session_id).toBeUndefined();
      if (profile === 'llama-server')
        expect(body.response_format).toHaveProperty('schema');
    } finally {
      transport.close();
      await fake.close();
    }
  },
);
test('Ollama cloud provenance stops before a chat request', async () => {
  const fake = await fakeEndpoint(() => ({
    body: { remote_model: 'generated-remote' },
  }));
  const transport = nodeTransport(fake.origin);
  try {
    await expect(
      new EndpointSource(
        fake.config({ profile: 'ollama' }),
        transport.transport,
      ).check(
        {
          criteria: PRESETS.filter((c) => c.id === 'political'),
          entries: [
            { id: 'e1', platform: 'x', kind: 'post', text: 'Generated.' },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('REMOTE_MODEL');
    expect(fake.requests.map((r) => r.url)).toEqual(['/api/show']);
  } finally {
    transport.close();
    await fake.close();
  }
});
test('production import graph excludes review, fakes and ambient identity; planted edges are detected', async () => {
  async function files(path: string): Promise<string[]> {
    return (
      await Promise.all(
        (await readdir(path, { withFileTypes: true })).map((entry) =>
          entry.isDirectory()
            ? files(join(path, entry.name))
            : Promise.resolve([join(path, entry.name)]),
        ),
      )
    ).flat();
  }
  const inputs = new Map(
    await Promise.all(
      (await files(join(root, 'src'))).map(
        async (path) => [path, await readFile(path, 'utf8')] as const,
      ),
    ),
  );
  const forbidden = (source: string) =>
    /workspace\/review|(?:from|import\s*\(?\s*)\s*['"][^'"]*(?:\/test\/|vitest)|\bprocess\s*(?:\.\s*env|\[\s*['"]env)|\b(?:homedir|userInfo)\s*\(|\bfetch\s*\(/.test(
      source,
    );
  for (const [path, source] of inputs)
    expect(forbidden(source), path).toBe(false);
  for (const planted of [
    "export * from '@socialprune/core/workspace/review';",
    'process.env.OPENAI_API_KEY',
    "import '../test/fake-endpoint.ts';",
    'fetch(url)',
  ])
    expect(forbidden(planted)).toBe(true);
  const visit = (path: string, seen = new Set<string>()): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = inputs.get(path);
    if (source === undefined) throw new Error('Production graph escaped src.');
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith('.'))
        visit(resolve(dirname(path), specifier), seen);
      else
        expect(
          specifier.startsWith('@socialprune/core') ||
            specifier.startsWith('node:'),
        ).toBe(true);
    }
  };
  visit(join(root, 'src/index.ts'));
  visit(join(root, 'src/node.ts'));
});
