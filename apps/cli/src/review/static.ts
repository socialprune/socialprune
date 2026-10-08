import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../cli/errors.ts';

export const REVIEW_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune";
export const REVIEW_HEADERS = {
  'Content-Security-Policy': REVIEW_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
} as const;

/** Source and release builds share this single asset resolution point. */
export function reviewAssetDirectory(moduleUrl = import.meta.url): string {
  return fileURLToPath(
    new URL(
      moduleUrl.endsWith('.ts') ? '../../../web/dist-review/' : '../web/',
      moduleUrl,
    ),
  );
}
export interface StaticAsset {
  bytes: Buffer;
  contentType: string;
}
const mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
};

export async function staticAssets(
  directory: string,
): Promise<ReadonlyMap<string, StaticAsset>> {
  const root = await lstat(directory).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink())
    throw new CliError('REVIEW_ASSETS_MISSING');
  const map = new Map<string, StaticAsset>();
  async function visit(path: string, parts: string[]): Promise<void> {
    for (const file of await readdir(path, { withFileTypes: true })) {
      if (file.isSymbolicLink()) throw new CliError('REVIEW_ASSETS_MISSING');
      const next = [...parts, file.name];
      if (file.isDirectory()) await visit(join(path, file.name), next);
      else if (file.isFile()) {
        map.set('/' + next.map(encodeURIComponent).join('/'), {
          bytes: await readFile(join(path, file.name)),
          contentType:
            mime[file.name.split('.').at(-1)!] ?? 'application/octet-stream',
        });
      }
    }
  }
  await visit(directory, []);
  const index = map.get('/index.html');
  if (!index) throw new CliError('REVIEW_ASSETS_MISSING');
  map.set('/', index);
  return map;
}
