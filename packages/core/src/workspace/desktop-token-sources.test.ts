import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import { expect, test } from 'vitest';
import {
  DesktopCliErrorCodeSchema,
  InstagramHostClassSchema,
  InstagramPathClassSchema,
  InstagramRateSignalSchema,
  InstagramStopTokenSchema,
  RunEndReasonSchema,
  RunErrorClassSchema,
  RunJournalCodeSchema,
  RunReadbackOutcomeSchema,
  RunStopDetailSchema,
  XPlatformCheckTokenSchema,
  XRateOperationSchema,
  xRateOperationToken,
} from './desktop-protocol.ts';
import {
  BrowserActionSchema,
  BrowserAttemptStateSchema,
  BrowserRunSchema,
} from '../model/browser.ts';

// Parse producer source as data. Importing the producer's runtime here would
// drag browser runners into core's TypeScript and renderer dependency graphs.
// The fixtures for drift are source strings only; no production registry is
// ever patched and no CLI, browser, network or workspace is started.
async function source(path: string): Promise<ts.SourceFile> {
  const text = await readFile(
    new URL(`../../../../${path}`, import.meta.url),
    'utf8',
  );
  return parse(text);
}
function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    'producer.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
function nodes<T extends ts.Node>(
  root: ts.Node,
  matches: (node: ts.Node) => node is T,
): T[] {
  const result: T[] = [];
  function visit(node: ts.Node): void {
    if (matches(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}
function declaration(file: ts.SourceFile, name: string): ts.Node {
  const found =
    nodes(file, ts.isVariableDeclaration).find(
      (node) => ts.isIdentifier(node.name) && node.name.text === name,
    )?.initializer ??
    nodes(file, ts.isTypeAliasDeclaration).find(
      (node) => node.name.text === name,
    )?.type;
  if (!found) throw new Error(`Missing producer declaration: ${name}`);
  return found;
}
function strings(node: ts.Node): string[] {
  return nodes(node, ts.isStringLiteral).map((entry) => entry.text);
}
function registryKeys(file: ts.SourceFile, name: string): string[] {
  const root = declaration(file, name);
  const object = nodes(root, ts.isObjectLiteralExpression)[0];
  if (!object) throw new Error(`Missing producer object: ${name}`);
  return object.properties.map((entry) => {
    if (!ts.isPropertyAssignment(entry) || !ts.isIdentifier(entry.name))
      throw new Error(`Changed registry shape: ${name}`);
    return entry.name.text;
  });
}
function assertCovered(
  tokens: readonly string[],
  known: readonly string[],
): void {
  expect(tokens.length).toBeGreaterThan(0);
  expect(
    [...new Set(tokens.filter((token) => !known.includes(token)))].sort(),
    'Producer tokens missing from the desktop contract',
  ).toEqual([]);
}

test('source lists cannot gain a CLI error or stop token without a desktop schema update', async () => {
  const errors = await source('apps/cli/src/cli/errors.ts');
  expect(registryKeys(errors, 'CLI_ERRORS').sort()).toEqual(
    [...DesktopCliErrorCodeSchema.options].sort(),
  );
  expect(strings(declaration(errors, 'PLATFORM_CHECK_REASONS'))).toEqual(
    XPlatformCheckTokenSchema.options,
  );
  const report = await source('apps/cli/src/browser/instagram/report.ts');
  expect(strings(declaration(report, 'CONTEXT_STOP_TOKENS'))).toEqual(
    InstagramStopTokenSchema.options,
  );
  const fill = await source('apps/cli/src/browser/x/fill/report.ts');
  expect(strings(declaration(fill, 'ErrorStopClass'))).toEqual(
    RunErrorClassSchema.options,
  );
  const copy = await source('apps/cli/src/browser/copy.ts');
  expect(strings(declaration(copy, 'DisplayEndReason')).sort()).toEqual(
    [...RunEndReasonSchema.options].sort(),
  );
  expect(strings(declaration(copy, 'ReadbackOutcome'))).toEqual(
    RunReadbackOutcomeSchema.options.filter(
      (token) => token !== 'not-completed',
    ),
  );
  const fillRun = await source('apps/cli/src/browser/x/fill/run.ts');
  expect(strings(fillRun)).toContain('not-completed');
  expect(RunReadbackOutcomeSchema.safeParse('not-completed').success).toBe(
    true,
  );
  for (const tokens of [
    DesktopCliErrorCodeSchema.options,
    XPlatformCheckTokenSchema.options,
    InstagramStopTokenSchema.options,
    RunErrorClassSchema.options,
  ])
    assertCovered(tokens, RunStopDetailSchema.options);
  assertCovered(
    BrowserRunSchema.shape.endReason.unwrap().options,
    RunEndReasonSchema.options,
  );
});

test('synthetic producer additions trip the same source-coverage assertion', async () => {
  const errors = await source('apps/cli/src/cli/errors.ts');
  const changed = parse(
    errors.text.replace(
      'export const CLI_ERRORS = {',
      'export const CLI_ERRORS = { GENERATED_ADDED_CODE: {},',
    ),
  );
  expect(registryKeys(changed, 'CLI_ERRORS')).toContain('GENERATED_ADDED_CODE');
  expect(() =>
    assertCovered(
      registryKeys(changed, 'CLI_ERRORS'),
      DesktopCliErrorCodeSchema.options,
    ),
  ).toThrow('Producer tokens missing');
  const report = await source('apps/cli/src/browser/instagram/report.ts');
  const changedList = parse(
    report.text.replace(
      'export const CONTEXT_STOP_TOKENS = [',
      "export const CONTEXT_STOP_TOKENS = ['generated-added-token',",
    ),
  );
  expect(() =>
    assertCovered(
      strings(declaration(changedList, 'CONTEXT_STOP_TOKENS')),
      InstagramStopTokenSchema.options,
    ),
  ).toThrow('Producer tokens missing');
});

test('Instagram signal identities and the accepted header-name grammar stay aligned with the producer', async () => {
  const signals = await source('apps/cli/src/browser/instagram/signals.ts');
  expect(strings(declaration(signals, 'HOST_CLASSES'))).toEqual(
    InstagramHostClassSchema.options,
  );
  expect(strings(declaration(signals, 'PATH_CLASSES'))).toEqual(
    InstagramPathClassSchema.options,
  );
  expect(strings(declaration(signals, 'RATE_SIGNALS'))).toEqual(
    InstagramRateSignalSchema.options,
  );
  // Any changed producer grammar needs an explicit desktop review, not an
  // assumption that an arbitrary new header is a value-free name.
  const patterns = nodes(signals, ts.isRegularExpressionLiteral).map(
    (node) => node.text,
  );
  expect(patterns).toContain('/^x-rate-?limit(?:-[a-z0-9-]{1,48})?$/');
  expect(patterns).toContain(
    '/^ratelimit(?:-(?:limit|remaining|reset|policy))?$/',
  );
});

test('journal producer codes and model action/state enums are all admitted, never arbitrary strings', async () => {
  const paths = [
    'apps/cli/src/browser/x/driver.ts',
    'apps/cli/src/browser/runner.ts',
    'apps/cli/src/browser/x/fill/run.ts',
    'apps/cli/src/browser/instagram/run.ts',
    'apps/cli/src/workspace/browser-journal.ts',
    'packages/core/src/workspace/originals-fill-writer.ts',
    'packages/core/src/workspace/instagram-context-writer.ts',
  ];
  const codes: string[] = [];
  for (const path of paths) {
    const file = await source(path);
    for (const entry of nodes(file, ts.isPropertyAssignment)) {
      if (entry.name.getText(file) !== 'code') continue;
      const container = entry.parent.parent;
      if (
        ts.isPropertyAssignment(container) &&
        container.name.getText(file) === 'stop'
      )
        assertCovered(strings(entry.initializer), [
          ...RunEndReasonSchema.options,
          ...RunStopDetailSchema.options,
        ]);
      else codes.push(...strings(entry.initializer));
    }
  }
  const selectors = await source('apps/cli/src/browser/instagram/selectors.ts');
  const result = declaration(selectors, 'ConfirmationResult');
  const unconfirmed = nodes(result, ts.isPropertySignature).find(
    (node) => node.name.getText(selectors) === 'code',
  );
  if (!unconfirmed?.type) throw new Error('Missing confirmation-result codes');
  codes.push(...strings(unconfirmed.type));
  const run = await source('apps/cli/src/browser/instagram/run.ts');
  // These codes are chosen in a conditional rather than stored as a registry.
  codes.push(
    ...nodes(run, ts.isStringLiteral)
      .map((node) => node.text)
      .filter((value) => ['no-row', 'window-full'].includes(value)),
  );
  assertCovered(codes, RunJournalCodeSchema.options);
  expect(RunJournalCodeSchema.safeParse('generated-unknown-code').success).toBe(
    false,
  );
  // Reuse, rather than mirror, the authoritative model enums.
  const { RunActionSchema, RunJournalOutcomeSchema, RunSettledStateSchema } =
    await import('./desktop-protocol.ts');
  expect(RunActionSchema).toBe(BrowserActionSchema);
  expect(RunJournalOutcomeSchema).toBe(BrowserAttemptStateSchema);
  expect(RunSettledStateSchema.options).toEqual(
    BrowserAttemptStateSchema.options.filter((token) => token !== 'sending'),
  );
});

test('X operation identities have a closed display projection for the open producer input', async () => {
  const read = await source('apps/cli/src/browser/x/fill/read.ts');
  const patterns = nodes(read, ts.isRegularExpressionLiteral).map(
    (node) => node.text,
  );
  const operations = patterns.flatMap((pattern) =>
    pattern.includes('(?:CreateTweet|')
      ? pattern
          .slice(pattern.indexOf('(?:') + 3, pattern.lastIndexOf(')'))
          .split('|')
      : pattern.includes('/TweetDetail$')
        ? ['TweetDetail']
        : [],
  );
  assertCovered(operations, XRateOperationSchema.options);
  const report = await source('apps/cli/src/browser/x/fill/report.ts');
  const groups = strings(declaration(report, 'operation')).filter((token) =>
    /^[a-z][a-z-]*$/.test(token),
  );
  assertCovered(groups, XRateOperationSchema.options);
  const run = await source('apps/cli/src/browser/x/fill/run.ts');
  expect(strings(run)).toContain('Stop detail: x-window-long\n');
  expect(RunStopDetailSchema.safeParse('x-window-long').success).toBe(true);
  expect(xRateOperationToken('TweetDetail')).toBe('TweetDetail');
  expect(xRateOperationToken('GeneratedNewOperation')).toBe('graphql-other');
  expect(XRateOperationSchema.safeParse('GeneratedNewOperation').success).toBe(
    false,
  );
});
