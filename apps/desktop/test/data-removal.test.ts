import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  rmdir,
  realpath,
  lstat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { createDataRemoval } from '../src/main/data-removal.ts';
import { lockGeneratedFile } from './file-lock.ts';
import { windowsShortPath } from './short-path.ts';
import { WINDOWS_QUERY_TEST_TIMEOUT_MS } from './windows-test-budgets.ts';
import type { DataRemovalReply } from '../src/data-removal-protocol.ts';

function expectPreview(reply: DataRemovalReply) {
  // Only a closed state/code is printed. Never dump a successful inventory.
  expect(
    reply.type === 'failed' ? `${reply.type}:${reply.code}` : reply.type,
  ).toBe('preview');
  if (reply.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
  return reply;
}

function sender() {
  const mainFrame = {
    url: 'app://socialprune/desktop.html',
    processId: 1,
    routingId: 2,
    parent: null,
  };
  const owner = {
    mainFrame,
    isDestroyed: () => false,
    getURL: () => mainFrame.url,
  };
  return {
    owner,
    event: { sender: owner, senderFrame: mainFrame, processId: 1, frameId: 2 },
  };
}
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'sp-removal-')),
    root = join(temporary, 'data');
  await mkdir(join(root, 'workspace'), { recursive: true });
  await mkdir(join(root, 'logs'));
  await writeFile(
    join(root, 'workspace', 'socialprune.sqlite'),
    'generated db',
  );
  await writeFile(join(root, 'workspace', 'backup.json'), 'generated backup');
  await writeFile(join(root, 'workspace', 'unknown.txt'), 'generated unknown');
  await writeFile(join(root, 'logs', 'desktop.ndjson'), '{}');
  await writeFile(join(root, 'ui-language.json'), '"de"');
  await writeFile(join(temporary, 'outside.txt'), 'generated outside');
  return { root, temporary };
}

test('removes only preview-approved managed entries; locked file, unknown, backup and external data remain', async () => {
  const data = await fixture(),
    { owner, event } = sender();
  const shutdown = vi.fn().mockResolvedValue(undefined),
    report = vi.fn().mockResolvedValue(undefined),
    quit = vi.fn();
  const remover = createDataRemoval({
    root: data.root,
    owner,
    idle: () => Promise.resolve(true),
    shutdown,
    report,
    quit,
    record: vi.fn(),
    fileOperations: {
      rmdir,
      unlink(path) {
        if (path.endsWith('socialprune.sqlite'))
          return Promise.reject(
            Object.assign(new Error('generated lock'), { code: 'EBUSY' }),
          );
        return unlink(path);
      },
    },
  });
  try {
    const preview = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(preview);
    if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'workspace/backup.json',
          disposition: 'retain',
          reason: 'backup',
        }),
        expect.objectContaining({
          name: 'workspace/unknown.txt',
          disposition: 'retain',
        }),
      ]),
    );
    const result = await remover.handle(event, {
      type: 'confirm',
      id: crypto.randomUUID(),
      token: preview.token,
      signedOut: true,
      phrase: 'ENTFERNEN',
      locale: 'de',
    });
    expect(result).toMatchObject({
      type: 'result',
      removed: 2,
      failures: 1,
      retained: 2,
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [expect.objectContaining({ reason: 'locked' })],
      }),
    );
    expect(await readdir(join(data.root, 'workspace'))).toEqual([
      'backup.json',
      'socialprune.sqlite',
      'unknown.txt',
    ]);
    expect(await readFile(join(data.temporary, 'outside.txt'), 'utf8')).toBe(
      'generated outside',
    );
    expect(
      JSON.parse(
        await readFile(
          join(data.root, `data-removal-receipt-${preview.token}.json`),
          'utf8',
        ),
      ),
    ).toMatchObject({ removed: 2, failures: ['locked'] });
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: true,
        phrase: 'ENTFERNEN',
        locale: 'de',
      }),
    ).toMatchObject({ type: 'failed', code: 'stale' });
  } finally {
    await rm(data.temporary, { recursive: true, force: true });
  }
});

test('preconditions, sender, phrase, expiry and a changed preview fail before shutdown/deletion', async () => {
  const data = await fixture(),
    { owner, event } = sender();
  let idle = false,
    now = 0;
  const shutdown = vi.fn().mockResolvedValue(undefined);
  const remover = createDataRemoval({
    root: data.root,
    owner,
    idle: () => Promise.resolve(idle),
    shutdown,
    report: vi.fn(),
    quit: vi.fn(),
    record: vi.fn(),
    now: () => now,
  });
  try {
    expect(
      await remover.handle(event, { type: 'preview', id: crypto.randomUUID() }),
    ).toMatchObject({ code: 'busy' });
    idle = true;
    await expect(
      remover.handle(
        { ...event, frameId: 99 },
        { type: 'preview', id: crypto.randomUUID() },
      ),
    ).rejects.toThrow('BRIDGE_REJECTED');
    const preview = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(preview);
    if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    await expect(
      remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: false,
        phrase: 'REMOVE',
        locale: 'en',
      }),
    ).rejects.toThrow();
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'de',
      }),
    ).toMatchObject({ code: 'invalid' });
    const next = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(next);
    if (next.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    now = 300001;
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: next.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'en',
      }),
    ).toMatchObject({ code: 'stale' });
    const changed = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(changed);
    if (changed.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    await writeFile(
      join(data.root, 'workspace', 'socialprune.sqlite'),
      'changed generated db',
    );
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: changed.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'en',
      }),
    ).toMatchObject({ code: 'stale' });
    expect(shutdown).not.toHaveBeenCalled();
  } finally {
    await rm(data.temporary, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'planted junction and linked root are refused, without touching their targets',
  async () => {
    const data = await fixture(),
      { owner, event } = sender();
    const outside = join(data.temporary, 'foreign');
    await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'generated foreign');
    await symlink(
      outside,
      join(data.root, 'workspace', 'originals'),
      'junction',
    );
    const remover = createDataRemoval({
      root: data.root,
      owner,
      idle: () => Promise.resolve(true),
      shutdown: vi.fn(),
      report: vi.fn(),
      quit: vi.fn(),
      record: vi.fn(),
    });
    try {
      const preview = await remover.handle(event, {
        type: 'preview',
        id: crypto.randomUUID(),
      });
      expectPreview(preview);
      if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
      expect(preview.rows).toContainEqual({
        name: 'workspace/originals',
        bytes: 0,
        disposition: 'retain',
        reason: 'link',
      });
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'en',
      });
      expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe(
        'generated foreign',
      );
      const rootLink = join(data.temporary, 'root-link');
      await symlink(data.root, rootLink, 'junction');
      const linked = createDataRemoval({
        root: rootLink,
        owner,
        idle: () => Promise.resolve(true),
        shutdown: vi.fn(),
        report: vi.fn(),
        quit: vi.fn(),
        record: vi.fn(),
      });
      expect(
        await linked.handle(event, {
          type: 'preview',
          id: crypto.randomUUID(),
        }),
      ).toMatchObject({ code: 'root' });
    } finally {
      await rm(data.temporary, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== 'win32')(
  'real Windows deny-delete handle survives with a partial receipt and no outside changes',
  async () => {
    const data = await fixture(),
      { owner, event } = sender();
    const unlock = await lockGeneratedFile(join(data.root, 'ui-language.json'));
    const report = vi.fn(),
      quit = vi.fn();
    const remover = createDataRemoval({
      root: data.root,
      owner,
      idle: () => Promise.resolve(true),
      shutdown: vi.fn(),
      report,
      quit,
      record: vi.fn(),
    });
    try {
      const preview = await remover.handle(event, {
        type: 'preview',
        id: crypto.randomUUID(),
      });
      expectPreview(preview);
      if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
      expect(
        await remover.handle(event, {
          type: 'confirm',
          id: crypto.randomUUID(),
          token: preview.token,
          signedOut: true,
          phrase: 'REMOVE',
          locale: 'en',
        }),
      ).toMatchObject({ type: 'result', failures: 1 });
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: [
            expect.objectContaining({
              name: 'ui-language.json',
              reason: 'locked',
            }),
          ],
        }),
      );
      expect(await readFile(join(data.root, 'ui-language.json'), 'utf8')).toBe(
        '"de"',
      );
      expect(quit).toHaveBeenCalledTimes(1);
    } finally {
      await unlock();
      await rm(data.temporary, { recursive: true, force: true });
    }
  },
);

test('managed profile attribution and closed cache leaves preserve nested unknown files and nested backups', async () => {
  const data = await fixture(),
    { owner, event } = sender();
  await mkdir(
    join(data.root, 'profiles', 'x', 'Default', 'Cache', 'Cache_Data'),
    { recursive: true },
  );
  await mkdir(join(data.root, 'profiles', 'instagram'), { recursive: true });
  await writeFile(
    join(data.root, 'profiles', 'x', 'socialprune-profile.json'),
    JSON.stringify({ version: '0.0.0', platform: 'x' }),
  );
  await writeFile(
    join(data.root, 'profiles', 'x', 'Default', 'Preferences'),
    '{}',
  );
  await writeFile(
    join(
      data.root,
      'profiles',
      'x',
      'Default',
      'Cache',
      'Cache_Data',
      'data_0',
    ),
    'generated cache',
  );
  await writeFile(
    join(
      data.root,
      'profiles',
      'x',
      'Default',
      'Cache',
      'Cache_Data',
      'planted.txt',
    ),
    'generated unknown',
  );
  await writeFile(
    join(data.root, 'profiles', 'x', 'backup.json'),
    'generated backup',
  );
  await writeFile(
    join(data.root, 'profiles', 'instagram', 'Local State'),
    'foreign unmarked profile',
  );
  const remover = createDataRemoval({
    root: data.root,
    owner,
    idle: () => Promise.resolve(true),
    shutdown: vi.fn(),
    report: vi.fn(),
    quit: vi.fn(),
    record: vi.fn(),
  });
  try {
    const preview = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(preview);
    if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    expect(preview.rows).toContainEqual(
      expect.objectContaining({
        name: 'profiles/x/Default/Cache/Cache_Data/planted.txt',
        disposition: 'retain',
      }),
    );
    expect(preview.rows).toContainEqual(
      expect.objectContaining({
        name: 'profiles/instagram/Local State',
        disposition: 'retain',
      }),
    );
    expect(
      preview.groups.find((group) => group.kind === 'profile-x')!.bytes,
    ).toBeGreaterThan(0);
    await remover.handle(event, {
      type: 'confirm',
      id: crypto.randomUUID(),
      token: preview.token,
      signedOut: true,
      phrase: 'REMOVE',
      locale: 'en',
    });
    expect(
      await readFile(
        join(
          data.root,
          'profiles',
          'x',
          'Default',
          'Cache',
          'Cache_Data',
          'planted.txt',
        ),
        'utf8',
      ),
    ).toBe('generated unknown');
    expect(
      await readFile(join(data.root, 'profiles', 'x', 'backup.json'), 'utf8'),
    ).toBe('generated backup');
    expect(
      await readFile(
        join(data.root, 'profiles', 'instagram', 'Local State'),
        'utf8',
      ),
    ).toBe('foreign unmarked profile');
    await expect(
      readFile(join(data.root, 'profiles', 'x', 'Default', 'Preferences')),
    ).rejects.toThrow();
  } finally {
    await rm(data.temporary, { recursive: true, force: true });
  }
});

test('a new run after preview prevents confirmation and a shutdown identity replacement is retained', async () => {
  const data = await fixture(),
    { owner, event } = sender();
  let idle = true;
  const shutdown = vi.fn(async () => {
    await unlink(join(data.root, 'workspace', 'socialprune.sqlite'));
    await writeFile(
      join(data.root, 'workspace', 'socialprune.sqlite'),
      'replacement generated database',
    );
  });
  const report = vi.fn();
  const remover = createDataRemoval({
    root: data.root,
    owner,
    idle: () => Promise.resolve(idle),
    shutdown,
    report,
    quit: vi.fn(),
    record: vi.fn(),
  });
  try {
    const preview = await remover.handle(event, {
      type: 'preview',
      id: crypto.randomUUID(),
    });
    expectPreview(preview);
    if (preview.type !== 'preview') throw new Error('EXPECTED_PREVIEW');
    idle = false;
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'en',
      }),
    ).toMatchObject({ code: 'busy' });
    expect(shutdown).not.toHaveBeenCalled();
    idle = true;
    expect(
      await remover.handle(event, {
        type: 'confirm',
        id: crypto.randomUUID(),
        token: preview.token,
        signedOut: true,
        phrase: 'REMOVE',
        locale: 'en',
      }),
    ).toMatchObject({ type: 'result', failures: 1 });
    expect(
      await readFile(
        join(data.root, 'workspace', 'socialprune.sqlite'),
        'utf8',
      ),
    ).toBe('replacement generated database');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [expect.objectContaining({ reason: 'changed' })],
      }),
    );
  } finally {
    await rm(data.temporary, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'a real generated 8.3 alias and drive-letter case resolve to one plain root before preview and removal',
  async () => {
    const data = await fixture(),
      { owner, event } = sender();
    try {
      const canonical = await realpath(data.root);
      const short = await windowsShortPath(data.root);
      const lowerDrive = canonical[0]!.toLowerCase() + canonical.slice(1);
      const aliases = short ? [short, lowerDrive] : [lowerDrive];
      expect(aliases.some((alias) => alias !== canonical)).toBe(true);
      for (const alias of aliases) {
        const stat = await lstat(alias),
          normal = await lstat(canonical);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.ino).toBe(normal.ino);
        expect(stat.dev).toBe(normal.dev);
        console.info(
          'DATA_REMOVAL_ALIAS_CLASS',
          JSON.stringify({
            aliasClass: alias === short ? '8.3' : 'drive-case',
            oldStringComparisonRejects: (await realpath(alias)) !== alias,
            sameIdentity: stat.ino === normal.ino && stat.dev === normal.dev,
            linked: stat.isSymbolicLink(),
          }),
        );
        const record = vi.fn(),
          shutdown = vi.fn();
        const remover = createDataRemoval({
          root: alias,
          owner,
          idle: () => Promise.resolve(true),
          shutdown,
          report: vi.fn(),
          quit: vi.fn(),
          record,
        });
        const reply = await remover.handle(event, {
          type: 'preview',
          id: crypto.randomUUID(),
        });
        console.info(
          'DATA_REMOVAL_ALIAS_PROOF',
          JSON.stringify({
            aliasClass: alias === short ? '8.3' : 'drive-case',
            sameIdentity: true,
            linked: false,
            state: reply.type,
            code: reply.type === 'failed' ? reply.code : null,
          }),
        );
        const preview = expectPreview(reply);
        expect(preview.root).toBe(canonical);
        expect(record).toHaveBeenCalledWith('DATA_REMOVAL_ROOT_CANONICALIZED');
        expect(preview.rows).toContainEqual(
          expect.objectContaining({
            name: 'workspace/backup.json',
            disposition: 'retain',
          }),
        );
        expect(shutdown).not.toHaveBeenCalled();
      }
      const remover = createDataRemoval({
        root: aliases[0]!,
        owner,
        idle: () => Promise.resolve(true),
        shutdown: vi.fn(),
        report: vi.fn(),
        quit: vi.fn(),
        record: vi.fn(),
      });
      const preview = expectPreview(
        await remover.handle(event, {
          type: 'preview',
          id: crypto.randomUUID(),
        }),
      );
      expect(
        await remover.handle(event, {
          type: 'confirm',
          id: crypto.randomUUID(),
          token: preview.token,
          signedOut: true,
          phrase: 'REMOVE',
          locale: 'en',
        }),
      ).toMatchObject({ type: 'result', failures: 0 });
      await expect(
        readFile(join(data.root, 'workspace', 'socialprune.sqlite')),
      ).rejects.toThrow();
      expect(
        await readFile(join(data.root, 'workspace', 'backup.json'), 'utf8'),
      ).toBe('generated backup');
    } finally {
      await rm(data.temporary, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'win32')(
  'a redirected parent resolves to the selected plain root without widening its removal boundary',
  async () => {
    const data = await fixture(),
      { owner, event } = sender();
    try {
      const alias = join(data.temporary, 'linked-parent');
      await symlink(data.root, alias, 'junction');
      const remover = createDataRemoval({
        root: join(alias, 'workspace'),
        owner,
        idle: () => Promise.resolve(true),
        shutdown: vi.fn(),
        report: vi.fn(),
        quit: vi.fn(),
        record: vi.fn(),
      });
      const preview = expectPreview(
        await remover.handle(event, {
          type: 'preview',
          id: crypto.randomUUID(),
        }),
      );
      expect(preview.root).toBe(await realpath(join(data.root, 'workspace')));
      // Ownership does not become recursive merely because the parent moved.
      // Without the workspace/ prefix these names are deliberately unknown.
      expect(preview.rows.every((row) => row.disposition === 'retain')).toBe(
        true,
      );
      expect(
        await readFile(
          join(data.root, 'workspace', 'socialprune.sqlite'),
          'utf8',
        ),
      ).toBe('generated db');
    } finally {
      await rm(data.temporary, { recursive: true, force: true });
    }
  },
);
