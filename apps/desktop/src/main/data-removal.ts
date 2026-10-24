import { createHash } from 'node:crypto';
import {
  lstat,
  readdir,
  realpath,
  rmdir,
  unlink,
  open,
  readFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { Stats } from 'node:fs';
import { DataRemovalRequestSchema } from '../data-removal-protocol.ts';
import type {
  DataRemovalReply,
  DataRemovalRow,
} from '../data-removal-protocol.ts';
import { authorizedSender } from './router.ts';
import type { SenderEvent, SenderIdentity } from './router.ts';

type Identity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
};
type Entry = { name: string; identity: Identity; directory: boolean };
type Plan = {
  token: string;
  expires: number;
  rows: DataRemovalRow[];
  entries: Entry[];
  fingerprint: string;
};
const identity = (s: Stats): Identity => ({
  dev: s.dev,
  ino: s.ino,
  size: s.size,
  mtimeMs: s.mtimeMs,
  birthtimeMs: s.birthtimeMs,
});
const code = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
const missing = (error: unknown) => {
  if (code(error) === 'ENOENT') return null;
  throw error;
};
const backup = (name: string) =>
  /(?:backup|before-migration|previous|\.bak(?:\.|$)|\.(?:zip|sqlite-backup)$)/i.test(
    name,
  );

/** Deliberately closed inventory. Anything the app cannot attribute stays.
 * Export/backup files are retained even inside a managed directory. */
export function managedDataFile(name: string): boolean {
  if (backup(name)) return false;
  if (name === 'ui-language.json') return true;
  if (/^logs\/(?:desktop|startup)\.ndjson$/.test(name)) return true;
  if (/^workspace\/socialprune\.sqlite(?:-(?:wal|shm|journal))?$/.test(name))
    return true;
  if (
    /^workspace\/(?:fill|delete|verify|context)-[a-f0-9]{64}\.txt$/.test(name)
  )
    return true;
  if (
    /^workspace\/originals\/\d{1,40}\/[1-4](?:\.(?:jpg|png|gif|webp|mp4)|-poster\.(?:jpg|png|webp))(?:\.part)?$/.test(
      name,
    )
  )
    return true;
  if (
    /^workspace\/context\/instagram\/[a-f0-9]+\/(?:image\.(?:jpg|png|webp)|shot\.jpg)$/.test(
      name,
    )
  )
    return true;
  const match = /^profiles\/(?:x|instagram)\/(.+)$/.exec(name);
  if (!match) return false;
  const tail = match[1]!;
  if (
    /^(?:socialprune-profile\.json|Local State|First Run|Last Version|lockfile|DevToolsActivePort|Variations|BrowserMetrics-spare\.pma)$/.test(
      tail,
    )
  )
    return true;
  if (
    /^Default\/(?:Preferences|Secure Preferences|History|Cookies|Login Data|Web Data|Favicons|Top Sites|Visited Links|Shortcuts|Network Action Predictor|DIPS|Trust Tokens|QuotaManager|Reporting and NEL|SharedStorage|TransportSecurity|Network Persistent State)(?:-(?:journal|wal|shm))?$/.test(
      tail,
    )
  )
    return true;
  if (
    /^Default\/Network\/(?:Cookies|Trust Tokens|Reporting and NEL|Network Persistent State)(?:-(?:journal|wal|shm))?$/.test(
      tail,
    )
  )
    return true;
  // Do not treat a whole browser-owned tree as ownership of every planted
  // leaf. Only the browser's closed cache/database filename forms qualify.
  return /^(?:Default\/(?:Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Local Storage|Session Storage|IndexedDB|Service Worker|Sessions|Storage)|ShaderCache|GrShaderCache|GraphiteDawnCache)\/(?:[A-Za-z0-9_. -]+\/)*(?:index|the-real-index|data_[0-9]+|f_[a-f0-9]+|[a-f0-9]{16}_[0-9]|[0-9]+\.(?:ldb|log)|MANIFEST-[0-9]+|CURRENT|LOCK|LOG(?:\.old)?|Session_[0-9]+|Tabs_[0-9]+)$/.test(
    tail,
  );
}

async function canonicalDirectory(path: string): Promise<void> {
  const absolute = resolve(path),
    root = parse(absolute).root;
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      resolve(await realpath(current)) !== current
    )
      throw new Error('REMOVAL_ROOT');
  }
}
function inside(root: string, name: string) {
  const target = resolve(root, name),
    part = relative(root, target);
  if (!part || isAbsolute(part) || part === '..' || part.startsWith('..' + sep))
    throw new Error('REMOVAL_ROOT');
  return target;
}

export function createDataRemoval(options: {
  root: string;
  owner: SenderIdentity;
  idle(): Promise<boolean>;
  shutdown(): Promise<void>;
  report(result: {
    removed: number;
    failures: DataRemovalRow[];
    retained: DataRemovalRow[];
  }): Promise<void>;
  quit(): void;
  record(code: string): void;
  now?: () => number;
  fileOperations?: {
    unlink(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
  };
}) {
  const root = resolve(options.root),
    now = options.now ?? Date.now;
  const fs = options.fileOperations ?? { unlink, rmdir };
  let plan: Plan | undefined,
    removing = false;
  let checking = false;
  let previewFrame: string | undefined;
  const scan = async () => {
    await canonicalDirectory(root);
    const rows: DataRemovalRow[] = [],
      entries: Entry[] = [];
    const profiles = new Set<string>();
    const walk = async (
      directory: string,
      prefix: string,
      depth: number,
      retain: 'backup' | 'unknown' | null = null,
    ): Promise<void> => {
      if (depth > 64 || rows.length + entries.length > 10000)
        throw new Error('REMOVAL_LIMIT');
      await canonicalDirectory(directory);
      for (const child of (await readdir(directory)).sort()) {
        const name = prefix ? `${prefix}/${child}` : child;
        if (name.length > 1024) throw new Error('REMOVAL_LIMIT');
        const path = inside(root, name),
          stat = await lstat(path);
        if (stat.isSymbolicLink()) {
          rows.push({ name, bytes: 0, disposition: 'retain', reason: 'link' });
        } else if (stat.isDirectory()) {
          if (retain || backup(name)) {
            const reason = retain ?? 'backup';
            const start = rows.length;
            await walk(path, name, depth + 1, reason);
            if (rows.length === start)
              rows.push({ name, bytes: 0, disposition: 'retain', reason });
          } else {
            let known =
              /^(?:workspace(?:\/(?:originals(?:\/\d{1,40})?|context(?:\/instagram(?:\/[a-f0-9]+)?)?))?|profiles|logs)$/.test(
                name,
              );
            const profile = /^profiles\/(x|instagram)(?:\/(.*))?$/.exec(name);
            if (profile) {
              const platform = profile[1]!,
                tail = profile[2];
              if (!tail) {
                const marker = join(path, 'socialprune-profile.json'),
                  info = await lstat(marker).catch(missing);
                if (
                  info?.isFile() &&
                  !info.isSymbolicLink() &&
                  info.nlink === 1 &&
                  info.size < 1024
                ) {
                  try {
                    const value: unknown = JSON.parse(
                      await readFile(marker, 'utf8'),
                    );
                    if (
                      value &&
                      typeof value === 'object' &&
                      'platform' in value &&
                      value.platform === platform &&
                      'version' in value &&
                      value.version === '0.0.0'
                    )
                      profiles.add(platform);
                  } catch {
                    /* A foreign or malformed profile is retained. */
                  }
                }
                known = profiles.has(platform);
              } else
                known =
                  profiles.has(platform) &&
                  /^(?:Default(?:\/Network)?|Default\/(?:Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Local Storage|Session Storage|IndexedDB|Service Worker|Sessions|Storage)(?:\/.*)?|ShaderCache(?:\/.*)?|GrShaderCache(?:\/.*)?|GraphiteDawnCache(?:\/.*)?|Crashpad(?:\/.*)?)$/.test(
                    tail,
                  );
            }
            if (!known) {
              const start = rows.length;
              await walk(path, name, depth + 1, 'unknown');
              if (rows.length === start)
                rows.push({
                  name,
                  bytes: 0,
                  disposition: 'retain',
                  reason: 'unknown',
                });
            } else {
              entries.push({ name, identity: identity(stat), directory: true });
              await walk(path, name, depth + 1);
            }
          }
        } else if (stat.isFile()) {
          const managed = !retain && managedDataFile(name) && stat.nlink === 1;
          rows.push({
            name,
            bytes: stat.size,
            disposition: managed ? 'remove' : 'retain',
            reason: managed
              ? 'managed'
              : (retain ?? (backup(name) ? 'backup' : 'unknown')),
          });
          if (managed)
            entries.push({ name, identity: identity(stat), directory: false });
        } else
          rows.push({
            name,
            bytes: 0,
            disposition: 'retain',
            reason: 'unknown',
          });
      }
    };
    await walk(root, '', 0);
    if (rows.length > 10000) throw new Error('REMOVAL_LIMIT');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ rows, entries }))
      .digest('hex');
    return { rows, entries, fingerprint };
  };
  const execute = async (raw: unknown): Promise<DataRemovalReply> => {
    const request = DataRemovalRequestSchema.parse(raw),
      id = request.id;
    const failed = (
      code: 'busy' | 'invalid' | 'stale' | 'root' | 'io',
    ): DataRemovalReply => ({ type: 'failed', id, code });
    if (removing || !(await options.idle())) return failed('busy');
    if (request.type === 'preview') {
      try {
        const value = await scan();
        plan = {
          ...value,
          token: crypto.randomUUID(),
          expires: now() + 300000,
        };
        const groups = (
          [
            'workspace',
            'profile-x',
            'profile-instagram',
            'logs',
            'settings',
          ] as const
        ).map((kind) => {
          const prefix =
            kind === 'profile-x'
              ? 'profiles/x/'
              : kind === 'profile-instagram'
                ? 'profiles/instagram/'
                : kind === 'settings'
                  ? 'ui-language.json'
                  : kind + '/';
          return {
            kind,
            bytes: plan!.rows
              .filter((row) => row.name.startsWith(prefix))
              .reduce((sum, row) => sum + row.bytes, 0),
          };
        });
        return {
          type: 'preview',
          id,
          token: plan.token,
          root,
          expiresAt: new Date(plan.expires).toISOString(),
          rows: plan.rows,
          groups,
        };
      } catch {
        options.record('DATA_REMOVAL_PREVIEW_FAILED');
        return failed('root');
      }
    }
    const current = plan;
    plan = undefined;
    if (!current || current.token !== request.token || now() > current.expires)
      return failed('stale');
    if (request.phrase !== (request.locale === 'de' ? 'ENTFERNEN' : 'REMOVE'))
      return failed('invalid');
    removing = true;
    let shutdown = false;
    let removed = 0;
    const failures: DataRemovalRow[] = [];
    const retained = current.rows.filter((row) => row.disposition === 'retain');
    let receipt: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const latest = await scan();
      if (latest.fingerprint !== current.fingerprint) return failed('stale');
      // The caller gates new IPC work while this operation owns shutdown.
      if (!(await options.idle())) return failed('busy');
      shutdown = true;
      await options.shutdown();
      await canonicalDirectory(root);
      // Create evidence before the first removal. A process loss leaves a
      // pending receipt rather than an invented completed outcome.
      receipt = await open(
        join(root, `data-removal-receipt-${current.token}.json`),
        'wx',
      );
      await receipt.writeFile(
        JSON.stringify({
          version: 1,
          state: 'started',
          at: new Date(now()).toISOString(),
        }),
      );
      await receipt.sync();
      for (const entry of current.entries.filter((entry) => !entry.directory)) {
        const target = inside(root, entry.name);
        try {
          await canonicalDirectory(dirname(target));
          const stat = await lstat(target).catch(missing);
          if (!stat) continue;
          // Closing SQLite can checkpoint and change size/mtime. The complete
          // preview was checked before shutdown; afterwards the same file
          // identity must remain, not a replacement or a linked name.
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.dev !== entry.identity.dev ||
            stat.ino !== entry.identity.ino ||
            stat.birthtimeMs !== entry.identity.birthtimeMs
          ) {
            failures.push({
              name: entry.name,
              bytes: entry.identity.size,
              disposition: 'retain',
              reason: 'changed',
            });
            continue;
          }
          await fs.unlink(target);
          removed++;
        } catch (error) {
          failures.push({
            name: entry.name,
            bytes: entry.identity.size,
            disposition: 'retain',
            reason: ['EBUSY', 'EPERM', 'EACCES'].includes(code(error))
              ? 'locked'
              : 'io',
          });
        }
      }
      for (const entry of current.entries
        .filter((entry) => entry.directory)
        .reverse()) {
        try {
          const path = inside(root, entry.name);
          await canonicalDirectory(path);
          const stat = await lstat(path);
          if (
            stat.dev !== entry.identity.dev ||
            stat.ino !== entry.identity.ino ||
            stat.birthtimeMs !== entry.identity.birthtimeMs
          )
            continue;
          if ((await readdir(path)).length === 0) await fs.rmdir(path);
        } catch {
          // Retained or locked children keep their parents. Never recurse.
        }
      }
      // Restart-surviving closed-token evidence contains no filenames/content.
      const completed = Buffer.from(
        JSON.stringify({
          version: 1,
          state: failures.length ? 'partial' : 'completed',
          at: new Date(now()).toISOString(),
          removed,
          retained: retained.length,
          failures: failures.map(({ reason }) => reason),
        }),
      );
      await receipt.write(completed, 0, completed.length, 0);
      await receipt.truncate(completed.length);
      await receipt.sync();
      await receipt.close();
      receipt = undefined;
      options.record(
        failures.length ? 'DATA_REMOVAL_PARTIAL' : 'DATA_REMOVAL_COMPLETED',
      );
      try {
        await options.report({ removed, failures, retained });
      } finally {
        options.quit();
      }
      return {
        type: 'result',
        id,
        removed,
        failures: failures.length,
        retained: retained.length,
      };
    } catch {
      options.record('DATA_REMOVAL_FAILED');
      if (shutdown) {
        failures.push({
          name: '.',
          bytes: 0,
          disposition: 'retain',
          reason: 'io',
        });
        try {
          await options.report({ removed, failures, retained });
        } finally {
          options.quit();
        }
      }
      return failed('io');
    } finally {
      await receipt?.close();
      removing = false;
    }
  };
  return {
    get busy() {
      return removing || checking;
    },
    async handle(event: SenderEvent, raw: unknown) {
      if (!authorizedSender(event, options.owner)) {
        options.record('DATA_REMOVAL_SENDER_REJECTED');
        throw new Error('BRIDGE_REJECTED');
      }
      if (checking) throw new Error('REMOVAL_BUSY');
      const request = DataRemovalRequestSchema.parse(raw);
      const frame = `${event.processId}:${event.frameId}`;
      if (request.type === 'confirm' && previewFrame !== frame)
        plan = undefined;
      if (request.type === 'preview') previewFrame = frame;
      checking = true;
      try {
        return await execute(request);
      } finally {
        checking = false;
      }
    },
  };
}
