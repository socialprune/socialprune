import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Locator, Response } from 'playwright-core';
import { capturePost } from './capture.ts';
import { instagramContextDirectory } from '../../workspace/context-files.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

test('capture takes only a received response, checks type/signature/size, limits screenshots and retains first files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-capture-'));
  const source = 'https://a.cdninstagram.com/generated.png?secret=planted';
  const png = Buffer.from(IG_FIXTURE.png, 'base64'),
    jpeg = Buffer.from([255, 216, 255, 0]);
  const response = (bytes: Buffer, type = 'image/png') =>
    ({
      status: () => 200,
      headers: () => ({ 'content-type': type }),
      body: () => Promise.resolve(bytes),
    }) as unknown as Response;
  const element = (bytes: Buffer) =>
    ({
      screenshot: (options: unknown) => {
        expect(options).toMatchObject({
          type: 'jpeg',
          quality: 60,
          scale: 'css',
          caret: 'initial',
          animations: 'allow',
        });
        return Promise.resolve(bytes);
      },
    }) as unknown as Locator;
  const free = () => Promise.resolve(10 * 1024 ** 3);
  try {
    const missing = await capturePost(
      directory,
      'missing',
      element(jpeg),
      source,
      new Map(),
      undefined,
      free,
    );
    expect(missing.image.status).toBe('not-captured');
    const success = await capturePost(
      directory,
      'stored',
      element(jpeg),
      source,
      new Map([[source, response(png)]]),
      undefined,
      free,
    );
    expect(success.image.status).toBe('stored');
    expect(success.screenshot.status).toBe('stored');
    expect(
      await readFile(
        join(instagramContextDirectory(directory, 'stored'), 'image.png'),
      ),
    ).toEqual(png);
    for (const [code, bytes, type, expected] of [
      ['type', png, 'text/plain', 'not-image'],
      ['magic', Buffer.from('not a PNG'), 'image/png', 'not-image'],
      [
        'size',
        Buffer.concat([png, Buffer.alloc(5 * 1024 ** 2)]),
        'image/png',
        'too-large',
      ],
    ] as const) {
      expect(
        (
          await capturePost(
            directory,
            code,
            element(jpeg),
            source,
            new Map([[source, response(bytes, type)]]),
            undefined,
            free,
          )
        ).image.status,
      ).toBe(expected);
    }
    const oversized = await capturePost(
      directory,
      'large-shot',
      element(Buffer.alloc(400001)),
      null,
      new Map(),
      undefined,
      free,
    );
    expect(oversized.screenshot).toEqual({
      file: null,
      bytes: null,
      status: 'too-large',
    });
    await expect(
      capturePost(
        directory,
        'disk',
        element(jpeg),
        source,
        new Map([[source, response(png)]]),
        undefined,
        () => Promise.resolve(0),
      ),
    ).rejects.toMatchObject({ code: 'DISK_LOW' });
    const repeated = await capturePost(
      directory,
      'stored',
      element(Buffer.from([255, 216, 255, 1, 2])),
      source,
      new Map([[source, response(png)]]),
      undefined,
      free,
    );
    expect(repeated.screenshot.bytes).toBe(4);
    expect(
      (await readdir(instagramContextDirectory(directory, 'stored'))).sort(),
    ).toEqual(['image.png', 'shot.jpg']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
