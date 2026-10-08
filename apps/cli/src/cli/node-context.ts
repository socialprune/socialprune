import { lstat, readdir, readFile } from 'node:fs/promises';
import { describeStructure } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { CliError } from './errors.ts';
import type { CliContext, CliStream, SchemaEntry } from './context.ts';
import { workspaceServices } from '../workspace/services.ts';
import { xGuide } from '@socialprune/adapter-x/guide';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';
import { openReviewBrowser } from '../review/opener.ts';
import { reviewAssetDirectory } from '../review/static.ts';

const guides: CliContext['services']['guides'] = [xGuide, instagramGuide];

async function schemaDirectories(): Promise<URL[]> {
  const packed = new URL('../schemas/', import.meta.url);
  if (
    await lstat(packed).then(
      (stat) => stat.isDirectory(),
      () => false,
    )
  )
    return [packed];
  const directories = [
    new URL('../schemas/', import.meta.resolve('@socialprune/core')),
  ];
  const cli = new URL('../../schemas/', import.meta.url);
  if (
    await lstat(cli).then(
      (stat) => stat.isDirectory(),
      () => false,
    )
  )
    directories.push(cli);
  return directories;
}

async function listSchemas(signal: AbortSignal): Promise<SchemaEntry[]> {
  const entries: SchemaEntry[] = [];
  async function visit(directory: URL, prefix = ''): Promise<void> {
    for (const file of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      signal.throwIfAborted();
      if (file.isDirectory()) {
        await visit(
          new URL(`${file.name}/`, directory),
          `${prefix}${file.name}/`,
        );
        continue;
      }
      if (!file.isFile() || !file.name.endsWith('.schema.json')) continue;
      const schema: unknown = JSON.parse(
        await readFile(new URL(file.name, directory), {
          encoding: 'utf8',
          signal,
        }),
      );
      if (
        typeof schema !== 'object' ||
        schema === null ||
        !('$id' in schema) ||
        typeof schema.$id !== 'string'
      )
        throw new CliError('SCHEMAS_FAILED');
      const path = `schemas/${prefix}${file.name}`;
      if (
        entries.some((entry) => entry.id === schema.$id || entry.path === path)
      )
        throw new CliError('SCHEMAS_FAILED');
      entries.push({ id: schema.$id, path });
    }
  }
  for (const directory of await schemaDirectories()) await visit(directory);
  if (entries.length === 0) throw new CliError('SCHEMAS_FAILED');
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function createNodeContext(
  stdout: CliStream,
  stderr: CliStream,
  signal = new AbortController().signal,
): CliContext {
  return {
    io: { stdout, stderr },
    now: () => new Date(),
    signal,
    nodeVersion: process.versions.node,
    pid: process.pid,
    stderrIsTerminal: 'isTTY' in stderr && stderr.isTTY === true,
    openBrowser: openReviewBrowser,
    reviewAssetDirectory: reviewAssetDirectory(),
    services: {
      guides,
      listSchemas,
      workspace: workspaceServices,
      async describeStructure(paths, signal) {
        for (const path of paths) {
          signal.throwIfAborted();
          const stat = await lstat(path).catch(() => null);
          if (
            !stat ||
            stat.isSymbolicLink() ||
            (!stat.isDirectory() && !(stat.isFile() && /\.zip$/i.test(path)))
          )
            throw new CliError('INVALID_ARCHIVE_PATH');
        }
        const archive = await openArchivePaths([...paths], { signal });
        try {
          return await describeStructure(archive, { signal });
        } finally {
          await archive.close();
        }
      },
    },
  };
}
