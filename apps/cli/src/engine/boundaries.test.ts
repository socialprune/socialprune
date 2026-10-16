import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import ts from 'typescript';

async function closure(root: string, planted?: [string, string]) {
  const paths = new Set<string>();
  async function visit(path: string): Promise<void> {
    path = resolve(path);
    if (paths.has(path)) return;
    paths.add(path);
    const source = await readFile(path, 'utf8');
    const tree = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports: string[] = [];
    function walk(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(tree);
    if (planted && path === planted[0]) imports.push(planted[1]);
    for (const specifier of imports) {
      const target = specifier.startsWith('.')
        ? resolve(dirname(path), specifier)
        : specifier.startsWith('@socialprune/') ||
            specifier === 'socialprune/engine'
          ? fileURLToPath(import.meta.resolve(specifier))
          : null;
      if (target?.endsWith('.ts')) await visit(target);
    }
  }
  await visit(root);
  return paths;
}
const engine = fileURLToPath(new URL('./index.ts', import.meta.url));
const entry = fileURLToPath(
  new URL('../../e2e/engine-test-entry.ts', import.meta.url),
);
function production(paths: Set<string>) {
  for (const path of paths)
    expect(path.replaceAll('\\', '/')).not.toMatch(
      /\/test-entry\.ts$|\/(?:test|e2e)\/|\.test\.ts$/,
    );
}
test('production facade cannot reach the generated test entry, including a planted wrong import edge', async () => {
  const real = await closure(engine);
  expect(real.size).toBeGreaterThan(20);
  production(real);
  expect(() => production(new Set([...real, entry]))).toThrow();
  expect(() => production(new Set([entry]))).toThrow();
  const wrong = await closure(engine, [
    engine,
    '../../e2e/engine-test-entry.ts',
  ]);
  expect(() => production(wrong)).toThrow();
}, 60000);

test('no command can gain the review decision path through the facade, including a planted import', async () => {
  const directory = fileURLToPath(new URL('../commands', import.meta.url));
  const roots: string[] = [];
  async function files(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await files(target);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
        roots.push(target);
    }
  }
  await files(directory);
  const assertCommands = (paths: Set<string>) => {
    for (const path of paths)
      expect(path.replaceAll('\\', '/')).not.toContain('/src/engine/');
  };
  for (const root of roots) assertCommands(await closure(root));
  expect(() => assertCommands(new Set([engine]))).toThrow();
  const wrong = await closure(roots[0]!, [roots[0]!, '../engine/index.ts']);
  expect(() => assertCommands(wrong)).toThrow();
}, 60000);
