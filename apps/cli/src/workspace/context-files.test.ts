import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import {
  instagramContextDirectory,
  instagramContextFileName,
  instagramContextFilePath,
  instagramContextFileSummary,
  instagramContextFileType,
} from './context-files.ts';

test('context filenames, lowercase byte hex and first bytes are exact, case-distinct and traversal-free', () => {
  const bytes = [
    { code: 'Ab_-9', hex: '41625f2d39' },
    { code: 'ab_-9', hex: '61625f2d39' },
  ];
  for (const value of bytes)
    expect(basename(instagramContextDirectory('generated', value.code))).toBe(
      value.hex,
    );
  for (const code of ['', '../bad', 'a/b', 'ü', 'a'.repeat(65)])
    expect(() => instagramContextDirectory('generated', code)).toThrow();
  for (const file of ['image.jpg', 'image.png', 'image.webp', 'shot.jpg'])
    expect(instagramContextFileName(file)).toBe(true);
  for (const file of [
    'image.gif',
    'shot.png',
    '../shot.jpg',
    'IMAGE.JPG',
    'image.jpg.part',
  ])
    expect(instagramContextFileName(file)).toBe(false);
  const jpeg = new Uint8Array([255, 216, 255]),
    png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    webp = Buffer.from('RIFF0000WEBP');
  expect(instagramContextFileType('image.jpg', jpeg)).toBe('image/jpeg');
  expect(instagramContextFileType('shot.jpg', jpeg)).toBe('image/jpeg');
  expect(instagramContextFileType('image.png', png)).toBe('image/png');
  expect(instagramContextFileType('image.webp', webp)).toBe('image/webp');
  for (const file of ['image.jpg', 'image.png', 'image.webp', 'shot.jpg'])
    for (const data of [new Uint8Array(), Buffer.from('generated-html')])
      expect(instagramContextFileType(file, data)).toBeNull();
  expect(instagramContextFileType('image.jpg', png)).toBeNull();
  expect(instagramContextFileType('shot.png', png)).toBeNull();
});

test('folder summary counts allowed regular context files once, not part files, reports or outside links', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'socialprune-context-files-'));
  try {
    expect(await instagramContextFileSummary(workspace)).toEqual({
      files: 0,
      bytes: 0,
    });
    const folder = instagramContextDirectory(workspace, 'Ab_-9');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'image.jpg'), new Uint8Array([255, 216, 255]));
    await writeFile(
      join(folder, 'shot.jpg'),
      new Uint8Array([255, 216, 255, 0]),
    );
    await writeFile(join(folder, 'image.png.part'), 'generated-part');
    await writeFile(
      join(workspace, 'context', 'instagram', 'canary-generated.json'),
      '{}',
    );
    expect(await instagramContextFilePath(workspace, 'Ab_-9', 'shot.jpg')).toBe(
      join(folder, 'shot.jpg'),
    );
    await expect(
      instagramContextFilePath(workspace, 'Ab_-9', '../outside'),
    ).rejects.toThrow();
    expect(await instagramContextFileSummary(workspace)).toEqual({
      files: 2,
      bytes: 7,
    });
    const foreign = join(workspace, 'foreign');
    await mkdir(foreign);
    await writeFile(join(foreign, 'image.jpg'), 'generated-foreign');
    await symlink(
      foreign,
      instagramContextDirectory(workspace, 'linked'),
      'junction',
    );
    await expect(
      instagramContextFilePath(workspace, 'linked', 'image.jpg'),
    ).rejects.toThrow('INVALID_CONTEXT_FILE');
    expect(await instagramContextFileSummary(workspace)).toEqual({
      files: 2,
      bytes: 7,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
