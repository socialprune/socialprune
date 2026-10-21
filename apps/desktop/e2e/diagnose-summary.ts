import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DIAGNOSE_VARIANTS } from '../packaging/diagnose-policy.ts';
import { pathToFileURL } from 'node:url';

export async function summarize(input: string, output: string) {
  const records: Record<string, Record<string, unknown>> = {};
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (
        entry.name === 'release-diagnose-summary.json' ||
        entry.name === 'release-diagnose-orchestrator.json'
      ) {
        const value = JSON.parse(await readFile(file, 'utf8')) as Record<
          string,
          unknown
        >;
        const variant = String(value.variant);
        if (
          !(variant in records) ||
          (entry.name === 'release-diagnose-summary.json' &&
            file.endsWith(join(variant, entry.name)))
        )
          records[variant] = value;
      }
    }
  };
  await mkdir(input, { recursive: true });
  await walk(input);
  const cell = (value: unknown) =>
    value === undefined || value === null
      ? 'unknown'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  const rows = DIAGNOSE_VARIANTS.map((variant) => {
    const r = records[variant] ?? { state: 'no-artifact-or-not-selected' };
    return {
      ...r,
      variant,
      diagnosticOnly: true,
      acceptance: false,
      commandLineChanged: [
        'chromium-verbose',
        'software-rendering',
        'no-renderer-sandbox',
      ].includes(variant),
    };
  });
  const columns = [
    'variant',
    'state',
    'windowCreated',
    'windowVisible',
    'loadURL',
    'rendererAlive',
    'gpuState',
    'appExit',
    'readinessReached',
    'branch',
    'commandLineChanged',
    'lifecycleShow',
    'reason',
  ] as const;
  const table =
    [
      'All variants are diagnostic only. None replaces CI release acceptance.',
      '',
      ...rows.flatMap((row) => [
        '## ' + row.variant,
        '',
        '| ' + columns.join(' | ') + ' |',
        '| ' + columns.map(() => '---').join(' | ') + ' |',
        '| ' +
          columns
            .map((key) =>
              cell((row as Record<string, unknown>)[key])
                .replaceAll('|', '\\|')
                .replaceAll('\n', ' '),
            )
            .join(' | ') +
          ' |',
        '',
      ]),
    ].join('\n') + '\n';
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'summary.md'), table);
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(
      { diagnosticOnly: true, acceptance: false, variants: rows },
      null,
      2,
    ),
  );
  console.log(table);
  return table;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await summarize(resolve(process.argv[2]!), resolve(process.argv[3]!));
