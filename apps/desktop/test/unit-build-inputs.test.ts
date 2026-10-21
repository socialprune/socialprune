import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { assertReleaseEntry } from '../packaging/release-entry-check.ts';

function buildInputs(text: string): string[] {
  const source = ts.createSourceFile(
    'unit.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Map<string, string>();
  const violations: string[] = [];
  const value = (node: ts.Node): string => {
    if (ts.isIdentifier(node))
      return names.get(node.text) ?? (node.text === 'dist' ? 'dist' : '');
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source).split('.').at(-1);
      if (name === 'executable') return 'dist/executable';
      if (name === 'join' || name === 'resolve')
        return node.arguments.map(value).join('/');
    }
    return '';
  };
  const inspect = (node: ts.Node) => {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text ?? node.name.text) === 'dist'
    )
      names.set(node.name.text, 'dist');
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      names.set(node.name.text, value(node.initializer));
    if (
      ts.isCallExpression(node) &&
      /^(?:readFile|readFileSync|extractFile|listPackage|stat|lstat|access|open|createReadStream)$/.test(
        node.expression.getText(source).split('.').at(-1)!,
      )
    ) {
      const argument = node.arguments[0];
      if (argument) {
        if (/(?:^|[/\\])dist(?:[/\\]|$)/.test(value(argument)))
          violations.push(node.getText(source));
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return violations;
}

test('desktop unit tests never read prebuilt dist inputs', async () => {
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.test.ts'))
        expect(buildInputs(await readFile(path, 'utf8')), path).toEqual([]);
    }
  };
  await walk(join(directory, 'test'));
});

test('unit input detector rejects direct, aliased and literal build reads, not test-generated scratch', () => {
  for (const source of [
    "readFile(join(dist, 'release/main.mjs'))",
    "import {dist as output} from '../packaging/paths.ts'; const file = join(output, 'release/main.mjs'); readFile(file)",
    "extractFile('apps/desktop/dist/release/resources/app.asar', 'main.mjs')",
    "readFile(executable('test'))",
  ])
    expect(buildInputs(source)).toHaveLength(1);
  expect(
    buildInputs(
      "writeFile(join(dist, 'release-test.json'), '{}'); readFile(join(scratch, 'generated.json'))",
    ),
  ).toEqual([]);
});

test('the post-build release check rejects test markers and remains wired to the mandatory fuse check', async () => {
  for (const marker of [
    'diagnostic-entry',
    'diagnostic-events=',
    'startup-fixture',
    'startup-case=',
  ])
    expect(() => assertReleaseEntry(marker)).toThrow('RELEASE_TEST_ENTRY');
  expect(() => assertReleaseEntry('production main')).not.toThrow();
  const check = await readFile(
    join(directory, 'packaging/check-fuses.ts'),
    'utf8',
  );
  expect(check).toContain('assertReleaseEntry(');
  expect(check).toContain('extractFile(');
  expect(check).not.toMatch(/existsSync|catch|skip/);
});
