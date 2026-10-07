import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { z } from 'zod';
import {
  AssessmentSchema,
  ItemSchema,
  WorkspaceSchema,
  DecisionEventSchema,
  OutcomeEventSchema,
  SubmissionSchema,
  ImportRecordSchema,
} from '../model/index.ts';
import * as v1 from '../model/v1.ts';

export const SCHEMA_MODELS = {
  item: ItemSchema,
  assessment: AssessmentSchema,
  'decision-event': DecisionEventSchema,
  'outcome-event': OutcomeEventSchema,
  submission: SubmissionSchema,
  'import-record': ImportRecordSchema,
  workspace: WorkspaceSchema,
  'v1/item': v1.ItemSchema,
  'v1/assessment': v1.AssessmentSchema,
  'v1/decision': v1.DecisionSchema,
  'v1/outcome': v1.OutcomeSchema,
  'v1/workspace': v1.WorkspaceSchema,
};
export async function generateJsonSchemas(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [name, schema] of Object.entries(SCHEMA_MODELS)) {
    const filename = `${name}.schema.json`;
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    files[filename] = await format(
      JSON.stringify({
        ...json,
        $id: `https://socialprune.github.io/socialprune/schemas/${filename}`,
      }),
      { parser: 'json', endOfLine: 'lf' },
    );
  }
  return files;
}
export async function runSchemaCommand(
  mode: string | undefined,
): Promise<number> {
  if (mode !== 'generate' && mode !== 'check') {
    console.error('Usage: schemas generate | check');
    return 2;
  }
  const root = new URL('../../schemas/', import.meta.url);
  const files = await generateJsonSchemas();
  if (mode === 'generate') await mkdir(root, { recursive: true });
  let drift = 0;
  for (const [filename, content] of Object.entries(files)) {
    const path = new URL(filename, root);
    if (mode === 'generate') {
      await mkdir(new URL('./', path), { recursive: true });
      await writeFile(path, content);
    } else {
      const existing = await readFile(path, 'utf8').catch(() => null);
      if (existing !== content) {
        drift++;
        console.error(`Schema drift: ${filename}`);
      }
    }
  }
  console.log(
    `JSON schemas: ${Object.keys(files).length} files, ${drift} differences (${mode}).`,
  );
  return drift ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await runSchemaCommand(process.argv[2]);
