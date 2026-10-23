import { z } from 'zod';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { SQLiteStore } from '../workspace/sqlite-store.ts';
import { originalDirectory } from '../originals/media.ts';
import { imageExtension } from '../originals/syndication.ts';
import { contextMedia } from '../review/context-media.ts';
import { byteRange } from '../review/original-media.ts';

export const MEDIA_CHUNK_BYTES = 256 * 1024;
const originalFile = z
  .string()
  .regex(/^[1-4](?:\.(?:jpg|png|gif|webp|mp4)|-poster\.(?:jpg|png|webp))$/);
const target = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('original'),
    id: z.string().regex(/^\d{1,40}$/),
    file: originalFile,
  }),
  z.strictObject({
    kind: z.literal('instagram'),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    file: z.enum(['image.jpg', 'image.png', 'image.webp', 'shot.jpg']),
  }),
]);
export const EngineMediaRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('open'),
    target,
    method: z.enum(['GET', 'HEAD']),
    range: z.string().optional(),
    ifRange: z.boolean().default(false),
  }),
  z.strictObject({ type: z.literal('read'), token: z.uuid() }),
  z.strictObject({ type: z.literal('close'), token: z.uuid() }),
]);
export type EngineMediaRequest = z.input<typeof EngineMediaRequestSchema>;
export const EngineMediaReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('opened'),
    status: z.union([
      z.literal(200),
      z.literal(206),
      z.literal(404),
      z.literal(416),
    ]),
    headers: z.strictObject({
      'Content-Type': z
        .enum([
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
        ])
        .optional(),
      'Content-Length': z.string().regex(/^\d+$/).optional(),
      'Content-Range': z
        .string()
        .regex(/^bytes (?:\d+-\d+|\*)\/\d+$/)
        .optional(),
      'Accept-Ranges': z.literal('bytes').optional(),
    }),
    token: z.uuid().nullable(),
  }),
  z.strictObject({
    type: z.literal('chunk'),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength <= MEDIA_CHUNK_BYTES),
    done: z.boolean(),
  }),
  z.strictObject({ type: z.literal('closed') }),
  z.strictObject({ type: z.literal('failed') }),
]);
export type EngineMediaReply = z.infer<typeof EngineMediaReplySchema>;
type Opened = {
  handle: FileHandle;
  size: number;
  contentType:
    'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'video/mp4';
};
const types = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
} as const;

/** Only IDs from the private scheme channel, never a renderer file-system path. */
export class EngineMedia {
  private readonly streams = new Map<
    string,
    {
      file: Opened;
      position: number;
      end: number;
      timer: NodeJS.Timeout;
      queue: Promise<unknown>;
    }
  >();
  private stopped = false;
  private opening = 0;
  private readonly active = new Set<Promise<EngineMediaReply>>();
  private readonly workspace: string;
  private readonly store: () => Promise<SQLiteStore>;
  constructor(workspace: string, store: () => Promise<SQLiteStore>) {
    this.workspace = workspace;
    this.store = store;
  }

  private async original(id: string, file: string): Promise<Opened | null> {
    const record = await (
      await this.store()
    ).read((tx) => tx.originals.get(id));
    if (
      !record?.media.some(
        (media) =>
          (media.status === 'stored' && media.file === file) ||
          media.poster === file,
      )
    )
      return null;
    let handle: FileHandle | undefined;
    try {
      const folder = await originalDirectory(this.workspace, id),
        path = join(folder, file),
        before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
        return null;
      handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const info = await handle.stat();
      await originalDirectory(this.workspace, id);
      const current = await lstat(path);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        current.isSymbolicLink() ||
        current.ino !== info.ino ||
        current.dev !== info.dev
      ) {
        await handle.close();
        return null;
      }
      const bytes = new Uint8Array(12),
        { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const extension = file.slice(
          file.lastIndexOf('.') + 1,
        ) as keyof typeof types,
        contentType = types[extension];
      if (
        extension === 'mp4'
          ? Buffer.from(bytes.subarray(4, 8)).toString('ascii') !== 'ftyp'
          : imageExtension(bytes.subarray(0, bytesRead), contentType) !==
            extension
      ) {
        await handle.close();
        return null;
      }
      return { handle, size: info.size, contentType };
    } catch {
      await handle?.close();
      return null;
    }
  }

  private async closeToken(token: string): Promise<void> {
    const stream = this.streams.get(token);
    if (!stream) return;
    this.streams.delete(token);
    clearTimeout(stream.timer);
    await stream.file.handle.close();
  }
  private timer(token: string) {
    return setTimeout(() => {
      const stream = this.streams.get(token);
      if (stream)
        stream.queue = stream.queue
          .then(() => this.closeToken(token))
          .catch(() => undefined);
    }, 30_000).unref();
  }
  request(raw: EngineMediaRequest): Promise<EngineMediaReply> {
    const task = this.execute(raw);
    this.active.add(task);
    void task.then(
      () => this.active.delete(task),
      () => this.active.delete(task),
    );
    return task;
  }
  private async execute(raw: EngineMediaRequest): Promise<EngineMediaReply> {
    const parsed = EngineMediaRequestSchema.safeParse(raw);
    if (!parsed.success || this.stopped) return { type: 'failed' };
    const input = parsed.data;
    if (input.type !== 'open') {
      const stream = this.streams.get(input.token);
      if (!stream)
        return input.type === 'close' ? { type: 'closed' } : { type: 'failed' };
      const task = stream.queue
        .then(async (): Promise<EngineMediaReply> => {
          if (input.type === 'close') {
            await this.closeToken(input.token);
            return { type: 'closed' };
          }
          clearTimeout(stream.timer);
          const bytes = new Uint8Array(
            Math.min(MEDIA_CHUNK_BYTES, stream.end - stream.position + 1),
          );
          const { bytesRead } = await stream.file.handle.read(
            bytes,
            0,
            bytes.length,
            stream.position,
          );
          if (bytesRead !== bytes.length) throw new Error('MEDIA_TRUNCATED');
          stream.position += bytesRead;
          const done = stream.position > stream.end;
          if (done) await this.closeToken(input.token);
          else stream.timer = this.timer(input.token);
          return { type: 'chunk', bytes, done };
        })
        .catch(async (): Promise<EngineMediaReply> => {
          await this.closeToken(input.token).catch(() => undefined);
          return { type: 'failed' };
        });
      stream.queue = task;
      return task;
    }
    if (this.streams.size + this.opening >= 16) return { type: 'failed' };
    this.opening++;
    let file: Opened | null = null;
    try {
      await this.store();
      file =
        input.target.kind === 'original'
          ? await this.original(input.target.id, input.target.file)
          : ((await contextMedia(
              this.workspace,
              `/context/instagram/${input.target.id}/${input.target.file}`,
            )) as Opened | null);
      if (!file)
        return { type: 'opened', status: 404, headers: {}, token: null };
      const range =
        input.target.kind === 'original'
          ? byteRange(
              input.method === 'GET' ? input.range : undefined,
              file.size,
              input.ifRange,
            )
          : { status: 200 as const, start: 0, end: file.size - 1 };
      const headers: Extract<EngineMediaReply, { type: 'opened' }>['headers'] =
        {
          'Content-Type': file.contentType,
          ...(input.target.kind === 'original'
            ? { 'Accept-Ranges': 'bytes' as const }
            : {}),
          ...(range.status === 416
            ? { 'Content-Range': `bytes */${file.size}` }
            : {
                'Content-Length': String(range.end - range.start + 1),
                ...(range.status === 206
                  ? {
                      'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
                    }
                  : {}),
              }),
        };
      if (
        this.stopped ||
        input.method === 'HEAD' ||
        range.status === 416 ||
        file.size === 0
      ) {
        await file.handle.close();
        return { type: 'opened', status: range.status, headers, token: null };
      }
      const token = crypto.randomUUID();
      this.streams.set(token, {
        file,
        position: range.start,
        end: range.end,
        timer: this.timer(token),
        queue: Promise.resolve(),
      });
      return { type: 'opened', status: range.status, headers, token };
    } catch {
      await file?.handle.close();
      return { type: 'opened', status: 404, headers: {}, token: null };
    } finally {
      this.opening--;
    }
  }
  async close(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.active);
    await Promise.all([...this.streams.values()].map((stream) => stream.queue));
    await Promise.all(
      [...this.streams.keys()].map((token) => this.closeToken(token)),
    );
  }
}
