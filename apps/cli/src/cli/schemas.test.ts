import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { executeCli } from './adapter.ts';
import { createNodeContext } from './node-context.ts';
import { findSchemaDifferences, generateCliSchemas } from './schema-files.ts';
import {
  CliErrorSchema,
  CliHelpSchema,
  CliResultSchema,
  CLI_SCHEMA_IDS,
} from './schemas.ts';
import { CLI_ERRORS, errorObject } from './errors.ts';
import { capturedContext } from './test/context.ts';

const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);
const empty = {
  guides: [],
  describeStructure() {
    return Promise.resolve({
      files: [],
      otherFiles: [],
      skippedPrivate: 0,
      rejectedEntries: 0,
    });
  },
  listSchemas() {
    return Promise.resolve([]);
  },
};

test('finite command output parses with the canonical CLI schema', async () => {
  for (const [args, status] of [
    [['--help', '--json'], 0],
    [['structure', archive, '--json'], 0],
    [['schemas', '--json'], 0],
    [['guide', 'x', '--json'], 2],
    [['scan', '--json'], 2],
    [['mcp', '--json'], 2],
    [['review', '--dry-run', '--json'], 2],
    [['structure', archive, '--bad', '--json'], 2],
  ] as const) {
    const capture = capturedContext(empty);
    const context = createNodeContext(
      capture.context.io.stdout,
      capture.context.io.stderr,
    );
    expect(await executeCli(args, context), args.join(' ')).toBe(status);
    expect(capture.stdout).toHaveLength(1);
    const output = CliResultSchema.parse(JSON.parse(capture.stdout[0]!));
    if (args[0] === '--help' && output.status !== 'error') {
      const help = CliHelpSchema.parse(output.data);
      const catalog = await context.services.listSchemas(context.signal);
      const ids = catalog.map((entry) => entry.id);
      expect(help.outputSchemaIds).toEqual([
        CLI_SCHEMA_IDS.result,
        CLI_SCHEMA_IDS.help,
      ]);
      expect(help.errorSchemaId).toBe(CLI_SCHEMA_IDS.error);
      for (const id of [
        ...help.outputSchemaIds,
        ...help.commands.flatMap((command) => command.outputSchemaIds),
      ])
        expect(ids).toContain(id);
      expect(
        help.commands.find((command) => command.path[0] === 'review'),
      ).toMatchObject({ available: false, writes: false, dryRun: true });
    }
  }
}, 60_000);

test('machine help cannot advertise missing schema files', async () => {
  const capture = capturedContext(empty);
  expect(await executeCli(['--help', '--json'], capture.context)).toBe(0);
  const result = CliResultSchema.parse(JSON.parse(capture.stdout[0]!));
  if (result.status === 'error') throw new Error('Expected help.');
  const help = CliHelpSchema.parse(result.data);
  expect(help.outputSchemaIds).toEqual([]);
  expect(help.errorSchemaId).toBeNull();
  for (const command of help.commands)
    expect(command.outputSchemaIds).toEqual([]);
});

test('error schema accepts only exact fixed codes, messages and exit values', () => {
  for (const code of Object.keys(CLI_ERRORS) as (keyof typeof CLI_ERRORS)[]) {
    const error = errorObject(code);
    expect(CliErrorSchema.parse(error)).toEqual(error);
    for (const invalid of [
      { ...error, code: 'UNKNOWN' },
      { ...error, message: 'Raw exception with private content' },
      { ...error, exitCode: 255 },
      { ...error, retryable: !error.retryable },
      { ...error, stack: 'Private stack' },
    ])
      expect(CliErrorSchema.safeParse(invalid).success).toBe(false);
  }
});

test('result schema rejects stale shape, unknown status and extra workspace data', () => {
  const valid = {
    schemaVersion: 1,
    command: 'structure',
    status: 'ok',
    data: { files: [] },
    warnings: [],
  };
  expect(CliResultSchema.parse(valid)).toEqual(valid);
  for (const invalid of [
    { ...valid, schemaVersion: 2 },
    { ...valid, status: 'complete' },
    { ...valid, workspace: 'unexpected' },
    { files: [] },
    { ...valid, data: undefined },
    { ...valid, warnings: 'notice' },
  ])
    expect(CliResultSchema.safeParse(invalid).success).toBe(false);
});

test('JSON schema files match fresh Zod generation byte for byte', async () => {
  const directory = new URL('../../schemas/', import.meta.url);
  const generated = await generateCliSchemas();
  expect(Object.keys(generated)).toEqual([
    'cli-result.schema.json',
    'cli-error.schema.json',
    'cli-help.schema.json',
  ]);
  for (const [file, content] of Object.entries(generated)) {
    expect(await readFile(new URL(file, directory), 'utf8'), file).toBe(
      content,
    );
  }
});

test('drift checker rejects each changed or missing file independently', async () => {
  const files = await generateCliSchemas();
  expect(
    await findSchemaDifferences(files, (name) =>
      Promise.resolve(files[name] ?? null),
    ),
  ).toEqual([]);
  for (const name of Object.keys(files)) {
    for (const mutation of [null, files[name]! + '\n']) {
      const differences = await findSchemaDifferences(files, (file) =>
        Promise.resolve(file === name ? mutation : (files[file] ?? null)),
      );
      expect(differences, name).toEqual([name]);
      // This is the same zero-difference gate used for completion.
      expect(() => expect(differences).toEqual([]), name).toThrow();
    }
  }
});

test('schema generation entrypoint is not imported by the CLI runtime', async () => {
  const source = await readFile(
    new URL('./node-context.ts', import.meta.url),
    'utf8',
  );
  const registry = await readFile(
    new URL('./registry.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toContain('schema-files');
  expect(registry).not.toContain('schema-files');
});
