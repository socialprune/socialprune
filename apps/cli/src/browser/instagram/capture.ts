import { lstat, mkdir, open, rename, rm, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Locator, Page, Request, Response } from 'playwright-core';
import type { InstagramContext } from '@socialprune/core';
import {
  instagramContextDirectory,
  instagramContextFilePath,
  instagramContextFileType,
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_SCREENSHOT_MAX_BYTES,
} from '../../workspace/context-files.ts';
import type { InstagramContextFile } from '../../workspace/context-files.ts';
import type { NetworkPolicy } from './network.ts';
import { productionPolicy } from './network.ts';
import { ContextStop } from './report.ts';

export function pageAnswers(
  page: Page,
  policy: NetworkPolicy = productionPolicy,
) {
  const images = new Map<string, Response>(),
    bodies: unknown[] = [],
    tasks = new Set<Promise<void>>();
  let totalBytes = 0;
  const generations = new WeakMap<Request, number>();
  let generation = 0,
    json = false;
  const sent = (request: Request) => {
    generations.set(request, generation);
  };
  const receive = (response: Response) => {
    const type = response.headers()['content-type']?.split(';', 1)[0] ?? '';
    if (policy.image(response.url())) images.set(response.url(), response);
    if (
      !json ||
      generations.get(response.request()) !== generation ||
      !policy.platform(response.url()) ||
      type !== 'application/json' ||
      response.status() !== 200 ||
      Number(response.headers()['content-length']) > INSTAGRAM_IMAGE_MAX_BYTES
    )
      return;
    const current = generation;
    const task = (async () => {
      try {
        const bytes = await response.body();
        if (
          bytes.length <= INSTAGRAM_IMAGE_MAX_BYTES &&
          current === generation &&
          json &&
          totalBytes + bytes.length <= 50 * 1024 ** 2
        ) {
          totalBytes += bytes.length;
          bodies.push(
            JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(bytes),
            ) as unknown,
          );
        }
      } catch {
        /* A missing or invalid second source is represented by the comparison. */
      }
    })();
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };
  page.on('request', sent);
  page.on('response', receive);
  return {
    images,
    bodies,
    reset(collectJSON: boolean) {
      generation++;
      images.clear();
      bodies.length = 0;
      totalBytes = 0;
      json = collectJSON;
    },
    async flush(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all([...tasks]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    },
    dispose() {
      json = false;
      generation++;
      page.off('response', receive);
      page.off('request', sent);
    },
  };
}
async function writeOnce(
  workspace: string,
  code: string,
  file: InstagramContextFile,
  bytes: Uint8Array,
  free: () => Promise<number>,
): Promise<void> {
  if ((await free()) < 5 * 1024 ** 3)
    throw new ContextStop('DISK_LOW', 'disk-low');
  let path = await instagramContextFilePath(workspace, code, file);
  if (await lstat(path).catch(() => null)) return;
  await mkdir(instagramContextDirectory(workspace, code), { recursive: true });
  path = await instagramContextFilePath(workspace, code, file);
  const part = path + '.part';
  // The final and temporary file names are built only from the checked helper path.
  const handle = await open(part, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await instagramContextFilePath(workspace, code, file);
    await rename(part, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(part, { force: true });
    throw error;
  }
}
export async function capturePost(
  workspace: string,
  code: string,
  element: Locator,
  source: string | null,
  images: ReadonlyMap<string, Response>,
  policy: NetworkPolicy = productionPolicy,
  free: () => Promise<number> = async () => {
    const info = await statfs(workspace);
    return info.bavail * info.bsize;
  },
): Promise<{
  image: InstagramContext['image'];
  screenshot: InstagramContext['screenshot'];
  imageBytes: number;
  shotBytes: number;
}> {
  const image: InstagramContext['image'] = {
    file: null,
    host: null,
    status: 'not-captured',
  };
  let imageBytes = 0;
  const response =
    source && policy.image(source) ? images.get(source) : undefined;
  if (response && source && response.status() === 200) {
    const type = response.headers()['content-type']?.split(';', 1)[0];
    const file =
      type === 'image/jpeg'
        ? 'image.jpg'
        : type === 'image/png'
          ? 'image.png'
          : type === 'image/webp'
            ? 'image.webp'
            : null;
    if (!file) image.status = 'not-image';
    else if (
      Number(response.headers()['content-length']) > INSTAGRAM_IMAGE_MAX_BYTES
    )
      image.status = 'too-large';
    else {
      const bytes = await response.body();
      imageBytes = bytes.length;
      if (bytes.length > INSTAGRAM_IMAGE_MAX_BYTES) image.status = 'too-large';
      else if (instagramContextFileType(file, bytes) !== type)
        image.status = 'not-image';
      else {
        await writeOnce(workspace, code, file, bytes, free);
        image.file = file;
        image.host = new URL(source).hostname;
        image.status = 'stored';
      }
    }
  }
  let screenshot: InstagramContext['screenshot'] = {
      file: null,
      bytes: null,
      status: 'failed',
    },
    shotBytes = 0;
  let bytes: Buffer | undefined;
  try {
    bytes = await element.screenshot({
      type: 'jpeg',
      quality: 60,
      scale: 'css',
      caret: 'initial',
      animations: 'allow',
      timeout: 30000,
    });
  } catch {
    /* Failed screenshots are not represented as stored. */
  }
  if (bytes) {
    shotBytes = bytes.length;
    if (bytes.length > INSTAGRAM_SCREENSHOT_MAX_BYTES)
      screenshot.status = 'too-large';
    else {
      await writeOnce(workspace, code, 'shot.jpg', bytes, free);
      const path = await instagramContextFilePath(workspace, code, 'shot.jpg');
      const info = await lstat(path);
      screenshot = { file: 'shot.jpg', bytes: info.size, status: 'stored' };
    }
  }
  return { image, screenshot, imageBytes, shotBytes };
}
export async function writeStructure(
  workspace: string,
  runId: string,
  report: unknown,
  rewrite = false,
): Promise<string> {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(runId))
    throw new Error('INVALID_CONTEXT_RUN');
  // Reuse the context path checker for all ancestors, including junction rejection.
  const sentinel = await instagramContextFilePath(workspace, '0', 'shot.jpg');
  const root = dirname(dirname(sentinel));
  await mkdir(root, { recursive: true });
  await instagramContextFilePath(workspace, '0', 'shot.jpg');
  const path = root + `/canary-${runId}.json`;
  if (rewrite) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('INVALID_CONTEXT_FILE');
  }
  const handle = await open(path, rewrite ? 'w' : 'wx');
  try {
    await handle.writeFile(JSON.stringify(report));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}
