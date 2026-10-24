import { readFile, lstat, realpath, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { parseSource } from './config.ts';
import type { SourceConfig, SourceCheck } from './config.ts';
import { ScanError, stopped } from './source.ts';
import type { Transport } from './endpoint.ts';

export async function inGitTree(path: string) {
  let current = dirname(path);
  while (true) {
    try {
      await lstat(join(current, '.git'));
      return true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw new ScanError('KEY_FILE_INVALID');
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
export async function loadSource(sourceFile: string) {
  const config = await loadSourceConfig(sourceFile);
  return loadSourceKey(config, sourceFile);
}
export async function loadSourceConfig(sourceFile: string) {
  try {
    const stat = await lstat(sourceFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      throw new ScanError('SOURCE_FILE_INVALID');
    return parseSource(JSON.parse(await readFile(sourceFile, 'utf8')));
  } catch {
    throw new ScanError('SOURCE_FILE_INVALID');
  }
}
export async function recordSourceCheck(
  sourceFile: string,
  config: SourceConfig,
  check: SourceCheck,
  signal: AbortSignal,
) {
  const path = resolve(sourceFile);
  const temporary = join(
    dirname(path),
    `.socialprune-check-${crypto.randomUUID()}.tmp`,
  );
  let created = false;
  try {
    stopped(signal);
    if ((await inGitTree(path)) || (await inGitTree(await realpath(path))))
      throw new ScanError('SOURCE_FILE_INVALID');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ScanError('SOURCE_FILE_INVALID');
    const current = await loadSourceConfig(path);
    if (JSON.stringify(current) !== JSON.stringify(config))
      throw new ScanError('SOURCE_FILE_INVALID');
    const updated = parseSource({ ...config, check });
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(JSON.stringify(updated, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    stopped(signal);
    if (JSON.stringify(await loadSourceConfig(path)) !== JSON.stringify(config))
      throw new ScanError('SOURCE_FILE_INVALID');
    await rename(temporary, path);
    created = false;
    return updated.check!;
  } catch (error) {
    if (error instanceof ScanError) throw error;
    throw new ScanError('SOURCE_FILE_INVALID');
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}
export function sourceKeyPath(
  config: import('./config.ts').SourceConfig,
  sourceFile: string,
) {
  return config.keyFile
    ? isAbsolute(config.keyFile)
      ? config.keyFile
      : resolve(dirname(sourceFile), config.keyFile)
    : null;
}
export async function loadSourceKey(
  config: import('./config.ts').SourceConfig,
  sourceFile: string,
) {
  if (!config.keyFile) return { config, key: null, keyPath: null };
  const keyPath = sourceKeyPath(config, sourceFile)!;
  try {
    if (
      (await inGitTree(keyPath)) ||
      (await inGitTree(await realpath(keyPath)))
    )
      throw new ScanError('KEY_FILE_INVALID');
    const stat = await lstat(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384)
      throw new ScanError('KEY_FILE_INVALID');
    const raw = await readFile(keyPath, 'utf8');
    const key = raw.replace(/\r?\n$/, '');
    if (!key || /\s|[{}[\]:=]/.test(key))
      throw new ScanError('KEY_FILE_INVALID');
    return { config, key, keyPath };
  } catch {
    throw new ScanError('KEY_FILE_INVALID');
  }
}
export function nodeTransport(origin: string): {
  transport: Transport;
  close: () => void;
} {
  const permitted = new URL(origin).origin;
  const httpAgent = new HttpAgent({ keepAlive: true, proxyEnv: undefined });
  const httpsAgent = new HttpsAgent({ keepAlive: true, proxyEnv: undefined });
  const transport: Transport = (input, signal) =>
    new Promise((resolveReply, reject) => {
      stopped(signal);
      const url = new URL(input.url);
      if (
        url.origin !== permitted ||
        !['http:', 'https:'].includes(url.protocol)
      ) {
        reject(new ScanError('REDIRECT_REFUSED'));
        return;
      }
      let settled = false;
      const finish = (error: ScanError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: input.method,
          headers: input.headers,
          agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
          signal,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 8_388_608) {
              finish(new ScanError('ENDPOINT_RESPONSE_INVALID'));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on('error', () =>
            finish(
              new ScanError(signal.aborted ? 'RUN_STOPPED' : 'CONNECTION'),
            ),
          );
          response.on('end', () => {
            if (settled) return;
            settled = true;
            resolveReply({
              status: response.statusCode ?? 0,
              headers: {
                'retry-after':
                  typeof response.headers['retry-after'] === 'string'
                    ? response.headers['retry-after']
                    : undefined,
              },
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      const timer = setTimeout(() => {
        finish(new ScanError('REQUEST_TIMEOUT'));
        request.destroy();
      }, input.timeoutSeconds * 1000);
      request.on('close', () => clearTimeout(timer));
      request.on('error', (error: NodeJS.ErrnoException) => {
        const code = String(error.code);
        finish(
          new ScanError(
            signal.aborted
              ? 'RUN_STOPPED'
              : /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)
                ? 'TLS'
                : 'CONNECTION',
          ),
        );
      });
      request.end(input.body);
    });
  return {
    transport,
    close() {
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}
