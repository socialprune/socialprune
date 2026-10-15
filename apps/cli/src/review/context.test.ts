import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  symlink,
  link,
  readFile,
} from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeContextFixture, contextInputs } from './test/context-fixture.ts';
import { request } from './test/helpers.ts';
import { startReviewServer } from './server.ts';
import { instagramContextDirectory } from '../workspace/context-files.ts';

async function setup(start = startReviewServer) {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-context-route-'));
  const assets = join(directory, 'assets'),
    workspace = join(directory, 'workspace');
  await mkdir(assets);
  await mkdir(workspace);
  await writeFile(
    join(assets, 'index.html'),
    '<!doctype html><title>Generated context</title>',
  );
  const fixture = await writeContextFixture(workspace);
  const server = await start({
    workspace,
    assetDirectory: assets,
    handleSignals: false,
  });
  const origin = server.url.slice(0, -1);
  const headers: Record<string, string> = {
    Host: new URL(origin).host,
    Origin: origin,
  };
  const session = await request(origin, {
    path: '/session',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-SocialPrune-Bootstrap': new URL(server.launchUrl).hash.slice(
        '#bootstrap='.length,
      ),
    },
  });
  const cookie = session.headers['set-cookie']![0]!.split(';', 1)[0]!;
  const auth = { ...headers, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' };
  const code = fixture.records[0]!.post.code,
    folder = instagramContextDirectory(workspace, code);
  const path = `/context/instagram/${code}/image.png`;
  return {
    ...fixture,
    workspace,
    directory,
    folder,
    server,
    origin,
    headers,
    auth,
    path,
    csrf: (session.data as { csrf: string }).csrf,
    get: (path: string, headers: Record<string, string> = auth) =>
      request(origin, { path, headers, method: 'GET' }),
    dispose: async () => {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

// Test-only executable mutations in memory. No file, CLI flag or environment
// value can select this server from the production entrypoint.
function moduleUrl(
  source: string,
  base: URL,
  replacements: Record<string, string> = {},
) {
  const resolved = source.replace(
    /from (['"])([^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => {
      const target =
        replacements[specifier] ??
        (specifier.startsWith('.')
          ? new URL(specifier, base).href
          : specifier.startsWith('@socialprune/')
            ? import.meta.resolve(specifier)
            : specifier);
      return `from '${target}'`;
    },
  );
  return (
    'data:text/javascript;base64,' +
    Buffer.from(stripTypeScriptTypes(resolved)).toString('base64')
  );
}
let mutant: Promise<typeof startReviewServer> | undefined;
function unguardedServer() {
  return (mutant ??= (async () => {
    const mediaUrl = new URL('./context-media.ts', import.meta.url);
    let media = await readFile(mediaUrl, 'utf8');
    media = media.replace(
      '  instagramContextFilePath,',
      '  instagramContextFilePath,\n  instagramContextDirectory,',
    );
    const start = media.indexOf('  const match ='),
      end = media.indexOf('  let handle:', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    media =
      media.slice(0, start) +
      `  const parts = path.split('/');
  const code = parts[3]!, file = parts.slice(4).join('/');
  if (!code || !file) return null;
` +
      media.slice(end);
    media = media.replace('if (!listed) return null;', 'void listed;');
    media = media.replace(
      'await instagramContextFilePath(workspace, code, file)',
      'join(instagramContextDirectory(workspace, code), decodeURIComponent(file))',
    );
    media = media.replace(
      'constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)',
      'constants.O_RDONLY',
    );
    media = media.replace(
      'await instagramContextFilePath(workspace, code, file);',
      'void instagramContextFilePath;',
    );
    media = media.replace(
      '      !info.isFile() ||',
      '      false && (!info.isFile() ||',
    );
    media = media.replace(
      '          : INSTAGRAM_IMAGE_MAX_BYTES)\n    ) {',
      '          : INSTAGRAM_IMAGE_MAX_BYTES))\n    ) {',
    );
    const typeStart = media.indexOf('    const contentType ='),
      typeEnd = media.indexOf('    if (!contentType)', typeStart);
    media =
      media.slice(0, typeStart) +
      `    void bytesRead; void instagramContextFileType;
    const contentType = file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
` +
      media.slice(typeEnd);
    const encodedMedia = moduleUrl(media, mediaUrl);
    const serverUrl = new URL('./server.ts', import.meta.url);
    let server = await readFile(serverUrl, 'utf8');
    server = server.replace(
      "if (header(request, 'host') !== authority)",
      "if (false && header(request, 'host') !== authority)",
    );
    server = server.replace(
      'origin !== `http://${authority}`',
      'false && origin !== `http://${authority}`',
    );
    server = server.replace(
      "if (!session.authenticated(header(request, 'cookie')) || stopping)",
      "if (false && (!session.authenticated(header(request, 'cookie')) || stopping))",
    );
    server = server.replace(
      "site !== 'same-origin'",
      "false && site !== 'same-origin'",
    );
    const encodedServer = moduleUrl(server, serverUrl, {
      './context-media.ts': encodedMedia,
    });
    return (
      (await import(/* @vite-ignore */ encodedServer)) as {
        startReviewServer: typeof startReviewServer;
      }
    ).startReviewServer;
  })());
}

test('context protocol reads exact items through SQLite; listed PNG/JPEG and HEAD are authenticated same-origin files', async () => {
  const h = await setup();
  try {
    const reply = await request(h.origin, {
      path: '/api/getInstagramContext',
      headers: {
        ...h.auth,
        'Content-Type': 'application/json',
        'X-SocialPrune-CSRF': h.csrf,
      },
      body: JSON.stringify({
        type: 'getInstagramContext',
        requestId: 'context-route',
        itemIds: [contextInputs.items[0]!.id, contextInputs.items[3]!.id],
      }),
    });
    expect(reply.status).toBe(200);
    expect(reply.data).toEqual([
      {
        type: 'instagramContext',
        requestId: 'context-route',
        records: [h.records[0]],
      },
    ]);
    for (const itemIds of [
      [],
      Array<string>(201).fill(contextInputs.items[0]!.id),
      [contextInputs.items[0]!.id, contextInputs.items[0]!.id],
      ['x:101'],
    ]) {
      expect(
        (
          await request(h.origin, {
            path: '/api/getInstagramContext',
            headers: {
              ...h.auth,
              'Content-Type': 'application/json',
              'X-SocialPrune-CSRF': h.csrf,
            },
            body: JSON.stringify({
              type: 'getInstagramContext',
              requestId: 'invalid-context',
              itemIds,
            }),
          })
        ).status,
      ).toBe(400);
    }
    const photo = await h.get(h.path);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect(photo.headers['content-security-policy']).toContain(
      "img-src 'self'",
    );
    expect(photo.headers['x-content-type-options']).toBe('nosniff');
    const shot = await h.get(h.path.replace('image.png', 'shot.jpg'));
    expect(shot.status).toBe(200);
    expect(shot.headers['content-type']).toBe('image/jpeg');
    const head = await request(h.origin, {
      path: h.path,
      method: 'HEAD',
      headers: h.auth,
    });
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
    expect(Number(head.headers['content-length'])).toBe(
      contextInputs.png.length,
    );
    const { ['Sec-Fetch-Site']: ignored, ...absent } = h.auth;
    void ignored;
    expect((await h.get(h.path, absent)).status).toBe(200);
  } finally {
    await h.dispose();
  }
}, 30_000);

type Harness = Awaited<ReturnType<typeof setup>>;
const controls: {
  name: string;
  expected: number;
  probe: (h: Harness) => Promise<{ status: number }>;
}[] = [
  {
    name: 'session cookie absent',
    expected: 401,
    probe: (h) => h.get(h.path, h.headers),
  },
  {
    name: 'cross-site Fetch Metadata',
    expected: 403,
    probe: (h) => h.get(h.path, { ...h.auth, 'Sec-Fetch-Site': 'cross-site' }),
  },
  {
    name: 'wrong Host',
    expected: 403,
    probe: (h) =>
      h.get(h.path, { ...h.auth, Host: `localhost:${h.server.address.port}` }),
  },
  {
    name: 'wrong Origin',
    expected: 403,
    probe: (h) =>
      h.get(h.path, { ...h.auth, Origin: 'https://generated.invalid' }),
  },
  ...['../unlisted.png', '%2e%2e%2funlisted.png'].map((suffix) => ({
    name: `traversal ${suffix}`,
    expected: 404,
    probe: async (h: Harness) => {
      await writeFile(join(h.folder, '..', 'unlisted.png'), contextInputs.png);
      return h.get(h.path.replace('image.png', suffix));
    },
  })),
  {
    name: 'file not listed as stored',
    expected: 404,
    probe: async (h) => {
      await writeFile(
        join(h.folder, 'image.webp'),
        Buffer.from('RIFF0000WEBP'),
      );
      return h.get(h.path.replace('image.png', 'image.webp'));
    },
  },
  {
    name: 'code has no record, including different letter case',
    expected: 404,
    probe: async (h) => {
      const code = h.records[0]!.post.code.toLowerCase(),
        folder = instagramContextDirectory(h.workspace, code);
      await mkdir(folder);
      await writeFile(join(folder, 'image.png'), contextInputs.png);
      return h.get(`/context/instagram/${code}/image.png`);
    },
  },
  {
    name: 'file is a link (hard link on Windows, symbolic link on Linux)',
    expected: 404,
    probe: async (h) => {
      const target = join(h.directory, 'outside.png');
      await writeFile(target, contextInputs.png);
      await rm(join(h.folder, 'image.png'));
      if (process.platform === 'win32')
        await link(target, join(h.folder, 'image.png'));
      else await symlink(target, join(h.folder, 'image.png'), 'file');
      return h.get(h.path);
    },
  },
  ...[0, 1, 2].map((depth) => ({
    name: `folder is a junction at depth ${depth}`,
    expected: 404,
    probe: async (h: Harness) => {
      const folder =
        depth === 0
          ? h.folder
          : depth === 1
            ? join(h.workspace, 'context', 'instagram')
            : join(h.workspace, 'context');
      const target = join(h.directory, 'outside');
      await rename(folder, target);
      await symlink(target, folder, 'junction');
      return h.get(h.path);
    },
  })),
  {
    name: 'wrong first bytes',
    expected: 404,
    probe: async (h) => {
      await writeFile(
        join(h.folder, 'image.png'),
        '<svg onload="generated()"/>',
      );
      return h.get(h.path);
    },
  },
  {
    name: 'short first bytes',
    expected: 404,
    probe: async (h) => {
      await writeFile(
        join(h.folder, 'image.png'),
        contextInputs.png.subarray(0, 4),
      );
      return h.get(h.path);
    },
  },
];
test.each(controls)(
  'RED CONTROL context rejects $name',
  async ({ name, expected, probe }) => {
    const red = await setup(await unguardedServer());
    try {
      const actual = (await probe(red)).status;
      expect(actual).toBe(200);
      expect(() => expect(actual).toBe(expected)).toThrow();
      console.log(
        `CONTEXT_RED_CONTROL ${name}: guard=absent expected=${expected} observed=${actual}`,
      );
    } finally {
      await red.dispose();
    }
    const h = await setup();
    try {
      expect((await probe(h)).status).toBe(expected);
    } finally {
      await h.dispose();
    }
  },
  30_000,
);
