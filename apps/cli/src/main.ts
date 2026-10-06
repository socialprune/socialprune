import { parseArgs } from 'node:util';
import { lstat } from 'node:fs/promises';
import { describeStructure } from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { helpText, structureTree } from './index.ts';

try {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(helpText());
  } else if (positionals[0] !== 'structure' || positionals.length < 2) {
    console.error('Usage: socialprune structure <path...> [--json]');
    process.exitCode = 2;
  } else {
    const paths = positionals.slice(1);
    let valid = true;
    for (const path of paths) {
      const stat = await lstat(path).catch(() => null);
      if (
        !stat ||
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !(stat.isFile() && /\.zip$/i.test(path)))
      )
        valid = false;
    }
    if (!valid) {
      console.error('Each path must name an existing ZIP file or directory.');
      process.exitCode = 2;
    } else {
      const archive = await openArchivePaths(paths);
      try {
        const report = await describeStructure(archive);
        console.log(
          values.json ? JSON.stringify(report, null, 2) : structureTree(report),
        );
      } finally {
        await archive.close();
      }
    }
  }
} catch (error) {
  const argumentError =
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('ERR_PARSE_ARGS');
  console.error(
    argumentError
      ? 'Invalid arguments. Use --help.'
      : 'Could not describe the archive structure.',
  );
  process.exitCode = argumentError ? 2 : 1;
}
