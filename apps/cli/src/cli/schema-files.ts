import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { z } from 'zod';
import { CLI_SCHEMA_MODELS } from './schemas.ts';

export async function generateCliSchemas(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [name, model] of Object.entries(CLI_SCHEMA_MODELS)) {
    files[name] = await format(
      JSON.stringify({
        ...z.toJSONSchema(model.schema, { target: 'draft-2020-12' }),
        $id: model.id,
      }),
      { parser: 'json', endOfLine: 'lf' },
    );
  }
  return files;
}

export async function findSchemaDifferences(
  files: Readonly<Record<string, string>>,
  readExisting: (name: string) => Promise<string | null>,
): Promise<string[]> {
  const differences: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    if ((await readExisting(name)) !== content) differences.push(name);
  }
  return differences;
}

export async function runCliSchemaCommand(
  mode: string | undefined,
): Promise<number> {
  if (mode !== 'generate' && mode !== 'check') {
    console.error('Usage: CLI schemas generate | check');
    return 2;
  }
  const directory = new URL('../../schemas/', import.meta.url);
  const files = await generateCliSchemas();
  if (mode === 'generate') await mkdir(directory, { recursive: true });
  const differences =
    mode === 'check'
      ? await findSchemaDifferences(files, (name) =>
          readFile(new URL(name, directory), 'utf8').catch(() => null),
        )
      : [];
  if (mode === 'generate') {
    for (const [name, content] of Object.entries(files))
      await writeFile(new URL(name, directory), content);
  }
  for (const name of differences) console.error(`CLI schema drift: ${name}`);
  console.log(
    `CLI JSON schemas: ${Object.keys(files).length} files, ${differences.length} differences (${mode}).`,
  );
  return differences.length ? 1 : 0;
}

if (import.meta.main)
  process.exitCode = await runCliSchemaCommand(process.argv[2]);
