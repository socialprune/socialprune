import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { generateTypes, validateCatalogs } from './i18n-catalog.ts';
import type { Catalog } from './i18n-catalog.ts';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const en = JSON.parse(
  await readFile(resolve(source, 'i18n/en.json'), 'utf8'),
) as Catalog;
const de = JSON.parse(
  await readFile(resolve(source, 'i18n/de.json'), 'utf8'),
) as Catalog;
validateCatalogs(en, de);
if (
  (await readFile(resolve(source, 'i18n/messages.d.ts'), 'utf8')) !==
  (await generateTypes(en))
)
  throw new Error('Message types drifted.');
const used = new Set<string>();
async function walk(folder: string) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      const tree = ts.createSourceFile(
        path,
        await readFile(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && Object.hasOwn(en, node.text))
          used.add(node.text);
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 't'
        ) {
          const argument = node.arguments[0];
          if (
            argument &&
            ts.isStringLiteral(argument) &&
            !Object.hasOwn(en, argument.text)
          )
            throw new Error(`Unknown ID ${argument.text}.`);
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
}
await walk(source);
for (const id of Object.keys(en))
  if (!used.has(id)) throw new Error(`Unused ID ${id}.`);
console.log(
  `Catalog check: ${used.size} IDs, two languages, argument parity and type drift passed.`,
);
