import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { loadNsisArchive } from '../packaging/nsis-download.ts';

const bytes = Buffer.from('generated NSIS archive bytes, never executed');
const digest = createHash('sha256').update(bytes).digest('hex');
test('a timed-out mirror falls back once, publishes verified bytes and subsequent callers use the cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-download-'));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === '/timeout') return;
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const receipts: unknown[] = [];
  try {
    const options = {
      cacheDirectory: join(root, 'shared'),
      workspace: join(root, 'scratch'),
      urls: [origin + '/timeout', origin + '/good'],
      timeoutMs: 250,
      wait: () => Promise.resolve(),
      record: (receipt: unknown) => {
        receipts.push(receipt);
      },
    };
    const result = await loadNsisArchive(digest, options);
    expect(result.bytes).toEqual(bytes);
    expect(result.path).toBe(join(root, 'shared/nsis-3.13.zip'));
    expect(await readFile(result.path)).toEqual(bytes);
    expect(requests).toEqual(['/timeout', '/good']);
    expect(receipts).toEqual([
      expect.objectContaining({ attempt: 1, cause: 'timeout' }),
    ]);
    const never = vi.fn(() =>
      Promise.reject(new Error('NETWORK_MUST_NOT_RUN')),
    );
    expect(
      (await loadNsisArchive(digest, { ...options, fetch: never })).bytes,
    ).toEqual(bytes);
    expect(never).not.toHaveBeenCalled();
    expect(await readdir(join(root, 'shared'))).toEqual(['nsis-3.13.zip']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('cached or downloaded SHA mismatch fails closed without trying another mirror or replacing the cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-mismatch-'));
  const fetcher = vi.fn(() =>
    Promise.resolve(new Response('generated wrong bytes')),
  );
  try {
    const options = {
      cacheDirectory: join(root, 'shared'),
      workspace: join(root, 'scratch'),
      fetch: fetcher,
      urls: [
        'https://generated.invalid/first',
        'https://generated.invalid/second',
      ],
      wait: () => Promise.resolve(),
    };
    await expect(loadNsisArchive(digest, options)).rejects.toThrow(
      'NSIS_CHECKSUM_MISMATCH',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readdir(join(root, 'shared'))).toEqual([]);
    await writeFile(
      join(root, 'shared/nsis-3.13.zip'),
      'generated corrupted cache',
    );
    fetcher.mockClear();
    await expect(loadNsisArchive(digest, options)).rejects.toThrow(
      'NSIS_CHECKSUM_MISMATCH',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'shared/nsis-3.13.zip'), 'utf8')).toBe(
      'generated corrupted cache',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transport retries are bounded, HTTP nontransient failures are not retried and local workspace copies stay readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-retries-'));
  try {
    const cacheDirectory = join(root, 'shared'),
      workspace = join(root, 'scratch');
    const fetcher = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    await expect(
      loadNsisArchive(digest, {
        cacheDirectory,
        workspace,
        fetch: fetcher,
        urls: [
          'https://generated.invalid/one',
          'https://generated.invalid/two',
        ],
        wait: () => Promise.resolve(),
        record: () => {},
      }),
    ).rejects.toThrow('NSIS_DOWNLOAD_EXHAUSTED');
    expect(fetcher).toHaveBeenCalledTimes(4);
    const missing = vi.fn(() =>
      Promise.resolve(new Response('', { status: 404 })),
    );
    await expect(
      loadNsisArchive(digest, { cacheDirectory, workspace, fetch: missing }),
    ).rejects.toThrow('NSIS_DOWNLOAD_FAILED:404');
    expect(missing).toHaveBeenCalledTimes(1);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'nsis-3.13.zip'), bytes);
    fetcher.mockClear();
    expect(
      (
        await loadNsisArchive(digest, {
          cacheDirectory,
          workspace,
          fetch: fetcher,
        })
      ).path,
    ).toBe(join(workspace, 'nsis-3.13.zip'));
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent acquisitions never expose partial bytes and verify the winner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-concurrent-'));
  const options = {
    cacheDirectory: root,
    workspace: root,
    urls: ['https://generated.invalid/archive'],
    fetch: () => Promise.resolve(new Response(bytes)),
  };
  try {
    const result = await Promise.all([
      loadNsisArchive(digest, options),
      loadNsisArchive(digest, options),
    ]);
    expect(result.map((entry) => entry.bytes)).toEqual([bytes, bytes]);
    expect(await readdir(root)).toEqual(['nsis-3.13.zip']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a cache created by another caller after a timeout is verified without another request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-peer-cache-'));
  const fetcher = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
  try {
    const result = await loadNsisArchive(digest, {
      cacheDirectory: root,
      fetch: fetcher,
      record: () => {},
      wait: () => writeFile(join(root, 'nsis-3.13.zip'), bytes),
    });
    expect(result.bytes).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a digest mismatch published concurrently is not overwritten or retried', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-peer-mismatch-'));
  const fetcher = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
  try {
    await expect(
      loadNsisArchive(digest, {
        cacheDirectory: root,
        fetch: fetcher,
        record: () => {},
        wait: () =>
          writeFile(join(root, 'nsis-3.13.zip'), 'generated corrupt peer'),
      }),
    ).rejects.toThrow('NSIS_CHECKSUM_MISMATCH');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(join(root, 'nsis-3.13.zip'), 'utf8')).toBe(
      'generated corrupt peer',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transient HTTP failure retries, but a checksum mismatch is still fatal after a transport retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-http-'));
  let calls = 0;
  const fetcher = vi.fn(() =>
    Promise.resolve(
      ++calls === 1
        ? new Response('', { status: 503 })
        : new Response('generated corrupt payload'),
    ),
  );
  const record = vi.fn();
  try {
    await expect(
      loadNsisArchive(digest, {
        cacheDirectory: root,
        fetch: fetcher,
        wait: () => Promise.resolve(),
        record,
      }),
    ).rejects.toThrow('NSIS_CHECKSUM_MISMATCH');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      attempt: 1,
      urlIndex: 0,
      cause: 'http',
      status: 503,
    });
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the observed fetch connect timeout retains its closed timeout cause and reuses the next verified response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-nsis-connect-timeout-'));
  const error = new TypeError('generated request failure', {
    cause: Object.assign(new Error('generated mirror failure'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    }),
  });
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce(new Response(bytes));
  const record = vi.fn();
  try {
    expect(
      (
        await loadNsisArchive(digest, {
          cacheDirectory: root,
          fetch: fetcher,
          wait: () => Promise.resolve(),
          record,
        })
      ).bytes,
    ).toEqual(bytes);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      attempt: 1,
      urlIndex: 0,
      cause: 'timeout',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
