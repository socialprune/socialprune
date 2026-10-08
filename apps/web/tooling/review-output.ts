import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { LOCAL_REVIEW_POLICY } from '../src/local-review/policy.ts';

export async function outputFiles(
  directory: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        files.set(
          relative(directory, path).replaceAll('\\', '/'),
          await readFile(path, 'utf8'),
        );
    }
  }
  await walk(directory);
  return files;
}

export function assertReviewOutput(files: ReadonlyMap<string, string>) {
  const html = files.get('index.html') ?? '';
  const policy =
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (policy !== LOCAL_REVIEW_POLICY)
    throw new Error('Local-review meta policy differs.');
  if (/rel=["']manifest|<script(?![^>]*\bsrc=)/.test(html))
    throw new Error('Manifest or inline script in local-review HTML.');
  for (const [path, content] of files) {
    if (
      /sw\.js$|\.webmanifest$|manifest\.json$|worker[^/]*\.js$|^test\//.test(
        path,
      )
    )
      throw new Error('Worker, manifest or test file in local-review build.');
    if (
      path.endsWith('.js') &&
      /new\s+(?:globalThis\.)?Worker\b|serviceWorker|indexedDB|sp-workspace|always-denied-review-fixture/.test(
        content,
      )
    )
      throw new Error(
        'Worker, browser workspace or test entry in local-review bundle.',
      );
  }
}

export function assertPagesIsolation(files: ReadonlyMap<string, string>) {
  for (const [path, content] of files) {
    if (
      /dist-review|review-main|local-review/.test(path) ||
      (path.endsWith('.js') &&
        /X-SocialPrune-Bootstrap|X-SocialPrune-CSRF|data-session|always-denied-review-fixture/.test(
          content,
        ))
    )
      throw new Error('Review-mode entry reached Pages output.');
  }
}
