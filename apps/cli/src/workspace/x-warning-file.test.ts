import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createProfile } from '../browser/profile.ts';
import {
  X_WARNING_FILE,
  clearXWarningFile,
  readXWarningFile,
  requireXWarningFileClear,
  writeXWarningFile,
} from './x-warning-file.ts';

const { rename } = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: rename.mockImplementation(actual.rename) };
});
afterEach(() => vi.clearAllMocks());

const warning = {
  runId: 'generated-warning',
  kind: 'http-429' as const,
  day: '2026-10-11',
  zone: 'UTC',
  createdAt: '2026-10-11T12:00:00.000Z',
};
const uuid = '12345678-1234-4234-9234-123456789abc';
const deadPart = `.socialprune-x-warning-2147483647-${uuid}.part`;

test.each(['x', 'instagram'] as const)(
  'D11 %s absent profile has no file gate and does not replace later profile validation',
  async (platform) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-d11-absent-'));
    try {
      const profile = join(root, 'missing');
      await expect(readXWarningFile(profile, platform)).resolves.toBeNull();
      await expect(
        requireXWarningFileClear(
          profile,
          '2026-10-13T12:00:00.000Z',
          'UTC',
          platform,
        ),
      ).resolves.toBeUndefined();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(['run', 'acknowledgement'] as const)(
  'D8 %s removes a positively dead warning temp but preserves the real gate',
  async (entry) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-temp-'));
    try {
      await createProfile(directory);
      await writeXWarningFile(directory, warning);
      const real = await readFile(join(directory, X_WARNING_FILE), 'utf8');
      await writeFile(join(directory, deadPart), '{"incomplete":');
      const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('Generated dead writer'), {
          code: 'ESRCH',
        });
      });
      try {
        if (entry === 'run') {
          await expect(
            requireXWarningFileClear(
              directory,
              '2026-10-13T12:00:00.000Z',
              'UTC',
            ),
          ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        } else {
          await expect(
            clearXWarningFile(directory, 'wrong-run'),
          ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        }
        expect(probe).toHaveBeenCalledWith(2147483647, 0);
      } finally {
        probe.mockRestore();
      }
      expect(await readFile(join(directory, X_WARNING_FILE), 'utf8')).toBe(
        real,
      );
      expect(await readdir(directory)).not.toContain(deadPart);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('D8 orphan bytes are never a gate copy, and live, unknown and legacy temp files are untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-ignore-'));
  const names = [
    deadPart,
    `.socialprune-x-warning-${process.pid}-${uuid}.part`,
    `.socialprune-x-warning-2147483646-${uuid}.part`,
    `.socialprune-x-warning-${uuid}.part`,
    '.socialprune-x-warning-not-owned.part',
  ];
  try {
    await createProfile(directory);
    for (const name of names)
      await writeFile(join(directory, name), JSON.stringify(warning));
    const probe = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 2147483647)
        throw Object.assign(new Error('Generated dead writer'), {
          code: 'ESRCH',
        });
      if (pid === 2147483646)
        throw Object.assign(new Error('Generated unknown writer'), {
          code: 'EPERM',
        });
      return true;
    });
    try {
      await expect(
        requireXWarningFileClear(directory, '2026-10-13T12:00:00.000Z', 'UTC'),
      ).resolves.toBeUndefined();
      expect(await readXWarningFile(directory)).toBeNull();
    } finally {
      probe.mockRestore();
    }
    expect(
      await lstat(join(directory, X_WARNING_FILE)).catch(() => null),
    ).toBeNull();
    expect(await readdir(directory)).not.toContain(deadPart);
    for (const name of names.slice(1))
      expect(await readFile(join(directory, name), 'utf8')).toBe(
        JSON.stringify(warning),
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('D8 a failed atomic rename removes its own temp and preserves the original gate bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-rename-'));
  try {
    await createProfile(directory);
    await writeXWarningFile(directory, warning);
    const before = await readFile(join(directory, X_WARNING_FILE), 'utf8');
    const failure = Object.assign(new Error('Generated rename failure'), {
      code: 'EPERM',
    });
    rename.mockRejectedValue(failure);
    await expect(
      writeXWarningFile(directory, {
        ...warning,
        runId: 'new-warning',
        day: '2026-10-12',
        createdAt: '2026-10-12T12:00:00.000Z',
      }),
    ).rejects.toBe(failure);
    expect(await readFile(join(directory, X_WARNING_FILE), 'utf8')).toBe(
      before,
    );
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining(['socialprune-profile.json', X_WARNING_FILE]),
    );
    expect(
      (await readdir(directory)).filter((name) => name.endsWith('.part')),
    ).toEqual([]);
  } finally {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    rename.mockImplementation(actual.rename);
    await rm(directory, { recursive: true, force: true });
  }
});

test('D8 temp cleanup never follows a planted directory link or removes its target gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d8-warning-link-'));
  const profile = join(root, 'profile');
  const target = join(root, 'target');
  try {
    await createProfile(profile);
    await createProfile(target);
    await writeXWarningFile(target, warning);
    const before = await readFile(join(target, X_WARNING_FILE), 'utf8');
    await symlink(
      target,
      join(profile, deadPart),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const probe = vi.spyOn(process, 'kill');
    try {
      expect(await readXWarningFile(profile)).toBeNull();
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
    expect((await lstat(join(profile, deadPart))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(target, X_WARNING_FILE), 'utf8')).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('D11 concurrent identical warning writers replace once and recheck inside the serialized operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d11-concurrent-'));
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    await createProfile(root);
    rename.mockImplementationOnce(
      async (...args: Parameters<typeof actual.rename>) => {
        entered();
        await barrier;
        await actual.rename(...args);
      },
    );
    const first = writeXWarningFile(root, warning);
    await started;
    const second = writeXWarningFile(root, warning);
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    await Promise.all([first, second]);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await readXWarningFile(root)).toEqual(warning);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});
test.each(['x', 'instagram'] as const)(
  'D11 %s admission waits for an in-flight warning replacement',
  async (platform) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-d11-admission-'));
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let writing: Promise<void> | undefined;
    let admission: Promise<unknown> | undefined;
    try {
      await createProfile(join(root, 'profile'), platform);
      rename.mockImplementationOnce(
        async (...args: Parameters<typeof actual.rename>) => {
          entered();
          await barrier;
          await actual.rename(...args);
        },
      );
      writing = writeXWarningFile(join(root, 'profile'), warning, platform);
      await started;
      let settled = false;
      admission = requireXWarningFileClear(
        join(root, 'profile'),
        '2026-10-13T12:00:00.000Z',
        'UTC',
        platform,
      )
        .then(
          () => null,
          (error: unknown) => error,
        )
        .then((result) => {
          settled = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      release();
      await writing;
      expect(await admission).toMatchObject({
        code:
          platform === 'x'
            ? 'X_WARNING_CARD_REQUIRED'
            : 'IG_WARNING_CARD_REQUIRED',
      });
    } finally {
      release();
      await writing;
      await admission;
      rename.mockImplementation(actual.rename);
      await rm(root, { recursive: true, force: true });
    }
  },
);
test('D11 transient EPERM is retried without deleting the old marker and permanent failure remains observable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d11-rename-'));
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  const failure = Object.assign(new Error('Generated held destination'), {
    code: 'EPERM',
  });
  try {
    await createProfile(root);
    await writeXWarningFile(root, warning);
    const next = {
      ...warning,
      runId: 'generated-next',
      day: '2026-10-12',
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    rename.mockImplementationOnce(async () => {
      expect(await readFile(join(root, X_WARNING_FILE), 'utf8')).toBe(
        JSON.stringify(warning),
      );
      throw failure;
    });
    await expect(writeXWarningFile(root, next)).resolves.toBeUndefined();
    expect(await readXWarningFile(root)).toEqual(next);
    rename.mockImplementation(async () => {
      await Promise.resolve();
      throw failure;
    });
    await expect(
      writeXWarningFile(root, {
        ...next,
        runId: 'generated-permanent',
        day: '2026-10-13',
        createdAt: '2026-10-13T12:00:00.000Z',
      }),
    ).rejects.toBe(failure);
    expect(await readXWarningFile(root)).toEqual(next);
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.part')),
    ).toEqual([]);
  } finally {
    rename.mockImplementation(actual.rename);
    await rm(root, { recursive: true, force: true });
  }
});
test('D11 distinct warning writers retain newest evidence in either ordering and reject stale acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d11-precedence-'));
  try {
    await createProfile(root);
    const newer = {
      ...warning,
      runId: 'generated-newer',
      day: '2026-10-12',
      createdAt: '2026-10-12T12:00:00.000Z',
    };
    await Promise.all([
      writeXWarningFile(root, newer),
      writeXWarningFile(root, warning),
    ]);
    expect(await readXWarningFile(root)).toEqual(newer);
    await expect(clearXWarningFile(root, warning.runId)).rejects.toMatchObject({
      code: 'X_WARNING_CARD_REQUIRED',
    });
    expect(await readXWarningFile(root)).toEqual(newer);
    const newest = {
      ...newer,
      runId: 'generated-newest',
      day: '2026-10-13',
      createdAt: '2026-10-13T12:00:00.000Z',
    };
    await Promise.all([
      writeXWarningFile(root, warning),
      writeXWarningFile(root, newest),
    ]);
    expect(await readXWarningFile(root)).toEqual(newest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test.skipIf(process.platform !== 'win32')(
  'D11 a real held Windows destination handle releases within the retry bound or preserves the old gate on exhaustion',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-d11-held-'));
    const holders: ReturnType<typeof spawn>[] = [];
    const hold = async () => {
      const path = join(root, X_WARNING_FILE).replaceAll("'", "''");
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$f=[System.IO.File]::Open('${path}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine('HELD'); [Console]::Out.Flush(); try { [Console]::ReadLine() } finally { $f.Dispose() }`,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      holders.push(child);
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (bytes: Buffer) => {
          if (bytes.toString().includes('HELD')) resolve();
        });
        child.once('error', reject);
        child.once('exit', () =>
          reject(new Error('Generated handle owner exited before ready')),
        );
      });
      return child;
    };
    const release = async (child: ReturnType<typeof spawn>) => {
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
      child.stdin!.end('\n');
      await exited;
    };
    try {
      await createProfile(root);
      await writeXWarningFile(root, warning);
      const oldBytes = await readFile(join(root, X_WARNING_FILE), 'utf8');
      const first = await hold();
      const next = {
        ...warning,
        runId: 'generated-real-handle',
        day: '2026-10-12',
        createdAt: '2026-10-12T12:00:00.000Z',
      };
      const writing = writeXWarningFile(root, next);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(await readFile(join(root, X_WARNING_FILE), 'utf8')).toBe(oldBytes);
      await release(first);
      await writing;
      expect(await readXWarningFile(root)).toEqual(next);
      const second = await hold();
      await expect(
        writeXWarningFile(root, {
          ...next,
          runId: 'generated-held-forever',
          day: '2026-10-13',
          createdAt: '2026-10-13T12:00:00.000Z',
        }),
      ).rejects.toSatisfy((error: unknown) =>
        Boolean(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['EPERM', 'EBUSY'].includes(String(error.code)),
        ),
      );
      expect(await readXWarningFile(root)).toEqual(next);
      await expect(
        requireXWarningFileClear(root, '2026-10-14T12:00:00.000Z', 'UTC'),
      ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
      await release(second);
    } finally {
      for (const child of holders)
        if (child.exitCode === null) child.stdin?.end('\n');
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
