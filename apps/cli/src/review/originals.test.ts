import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { request, running } from './test/helpers.ts';
import { fixture } from '../originals/test/server.ts';
import { migrateOriginal } from '@socialprune/core';

test('real database worker returns originals only through authenticated bounded HTTP and serves raster files on the same origin', async () => {
  const data = await running();
  const original = migrateOriginal({
    id: fixture.references[0]!,
    status: 'fetched',
    fetchedAt: '2026-10-11T00:00:00Z',
    text: fixture.fetched.text,
    authorName: fixture.fetched.user.name,
    authorHandle: fixture.fetched.user.screen_name,
    photos: [
      {
        url: 'https://pbs.twimg.com/generated.png',
        file: '1.png',
        status: 'stored',
      },
    ],
    quotedId: null,
    parentId: null,
    raw: null,
    textCompleteness: 'unknown',
    video: null,
  });
  const path = `/originals/${original.id}/1.png`;
  try {
    const store = await SQLiteStore.open(
      join(data.workspace, 'socialprune.sqlite'),
    );
    await store.write((tx) => tx.originals.put(original));
    await store.close();
    await mkdir(join(data.workspace, 'originals', original.id), {
      recursive: true,
    });
    await writeFile(
      join(data.workspace, 'originals', original.id, '1.png'),
      Buffer.from(fixture.pngBase64, 'base64'),
    );
    const denied = await request(data.origin, {
      path,
      method: 'GET',
      headers: { Host: new URL(data.origin).host },
    });
    expect(denied.status).toBe(401);
    await data.authenticate();
    const result = await data.api({
      type: 'getOriginals',
      requestId: 'generated-read',
      ids: [original.id, '900009'],
    });
    expect(result.status).toBe(200);
    expect(result.replies).toEqual([
      { type: 'originals', requestId: 'generated-read', originals: [original] },
    ]);
    const photo = await request(data.origin, {
      path,
      method: 'GET',
      headers: data.authHeaders(),
    });
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(photo.headers['content-security-policy']).toContain(
      "img-src 'self'",
    );
    for (const options of [
      {
        path,
        headers: {
          ...data.authHeaders(),
          Host: 'localhost:' + data.server.address.port,
        },
      },
      {
        path,
        headers: { ...data.authHeaders(), Origin: 'https://generated.invalid' },
      },
      {
        path,
        headers: { ...data.authHeaders(), 'Sec-Fetch-Site': 'cross-site' },
      },
    ])
      expect(
        (await request(data.origin, { method: 'GET', ...options })).status,
      ).toBe(403);
    for (const invalid of [
      '/originals/../socialprune.sqlite',
      '/originals/900001/2.png',
      '/originals/900001/%2e%2e%2fprivate.png',
      '/originals/900001/1.svg',
    ])
      expect(
        (
          await request(data.origin, {
            path: invalid,
            method: 'GET',
            headers: data.authHeaders(),
          })
        ).status,
      ).toBe(404);
    const invalid = await request(data.origin, {
      path: '/api/getOriginals',
      headers: data.authHeaders(),
      body: JSON.stringify({
        type: 'getOriginals',
        requestId: 'invalid',
        ids: Array<string>(51).fill(original.id),
      }),
    });
    expect(invalid.status).toBe(400);
    await writeFile(
      join(data.workspace, 'originals', original.id, '1.png'),
      '<svg onload="generated()"/>',
    );
    expect(
      (
        await request(data.origin, {
          path,
          method: 'GET',
          headers: data.authHeaders(),
        })
      ).status,
    ).toBe(404);
  } finally {
    await data.dispose();
  }
}, 30_000);
