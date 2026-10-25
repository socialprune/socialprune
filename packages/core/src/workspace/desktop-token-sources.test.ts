import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import { expect, test } from 'vitest';
import {
  DesktopCliErrorCodeSchema,
  DesktopErrorCodeSchema,
  InstagramHostClassSchema,
  InstagramPathClassSchema,
  InstagramRateSignalSchema,
  InstagramStopTokenSchema,
  RunEndReasonSchema,
  RunErrorClassSchema,
  RunJournalCodeSchema,
  RunReadbackOutcomeSchema,
  RunStopDetailSchema,
  RunViewSchema,
  XPlatformCheckTokenSchema,
  XRateOperationSchema,
  xRateOperationToken,
} from './desktop-protocol.ts';
import type { DesktopRunMode } from './desktop-protocol.ts';
import {
  BrowserActionSchema,
  BrowserAttemptStateSchema,
  BrowserRunSchema,
} from '../model/browser.ts';
import { WORKSPACE_ERROR_CODES } from './errors.ts';

const desktopOnlyCodes = ['ENGINE_UNAVAILABLE', 'LINK_UNKNOWN'] as const;

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

function numberValue(node: ts.Node): number {
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll('_', ''));
  if (ts.isBinaryExpression(node)) {
    const left = numberValue(node.left),
      right = numberValue(node.right);
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken)
      return left * right;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return left + right;
  }
  throw new Error(`Changed numeric producer expression: ${node.getText()}`);
}
function numericObject(
  file: ts.SourceFile,
  name: string,
): Record<string, number> {
  const object = nodes(
    declaration(file, name),
    ts.isObjectLiteralExpression,
  )[0];
  if (!object) throw new Error(`Missing pace object: ${name}`);
  return numericProperties(object);
}
function numericProperties(
  object: ts.ObjectLiteralExpression,
): Record<string, number> {
  return Object.fromEntries(
    object.properties.map((entry) => {
      if (!ts.isPropertyAssignment(entry) || !ts.isIdentifier(entry.name))
        throw new Error('Changed pace object property');
      return [entry.name.text, numberValue(entry.initializer)];
    }),
  );
}
function orderBounds(file: ts.SourceFile, name: string, field: string) {
  const entry = nodes(declaration(file, name), ts.isPropertyAssignment).find(
    (node) => ts.isIdentifier(node.name) && node.name.text === field,
  );
  if (!entry) throw new Error(`Missing order field: ${field}`);
  const calls = nodes(entry.initializer, ts.isCallExpression);
  const bound = (name: string) => {
    const call = calls.find(
      (node) =>
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === name,
    );
    if (!call?.arguments[0]) throw new Error(`Missing ${field}.${name}`);
    return numberValue(call.arguments[0]);
  };
  expect(
    calls.some(
      (node) =>
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'int',
    ),
  ).toBe(true);
  return { min: bound('min'), max: bound('max') };
}
function functionSource(
  file: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration {
  const found = nodes(file, ts.isFunctionDeclaration).find(
    (node) => node.name?.text === name,
  );
  if (!found) throw new Error(`Missing producer function: ${name}`);
  return found;
}
function methodSource(file: ts.SourceFile, name: string): ts.MethodDeclaration {
  const found = nodes(file, ts.isMethodDeclaration).find(
    (node) => node.name.getText(file) === name,
  );
  if (!found) throw new Error(`Missing producer method: ${name}`);
  return found;
}

function rateWaitBound(file: ts.SourceFile): number {
  expect(compact(methodSource(file, 'beforePage'))).toContain(
    'returnthis.before(now,0);',
  );
  expect(compact(methodSource(file, 'beforeDeletion'))).toContain(
    'returnthis.before(now,1);',
  );
  const before = methodSource(file, 'before');
  expect(compact(before)).toContain(
    'window.latestRemaining-reserve<window.limit/2&&window.latestReset>now',
  );
  const ceiling = nodes(before, ts.isBinaryExpression).find(
    (node) =>
      node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken &&
      compact(node.left) === 'window.latestReset-now',
  );
  const buffer = declaration(file, 'ms');
  if (
    !ceiling ||
    !ts.isBinaryExpression(buffer) ||
    buffer.operatorToken.kind !== ts.SyntaxKind.PlusToken
  )
    throw new Error('Changed rate-window wait shape');
  return numberValue(ceiling.right) + numberValue(buffer.right);
}

// Only result arms emit a code. Condition operands such as run modes are inputs,
// not journal tokens; every literal result still goes through closed coverage.
function emittedStrings(node: ts.Node): string[] {
  if (ts.isConditionalExpression(node))
    return [
      ...emittedStrings(node.whenTrue),
      ...emittedStrings(node.whenFalse),
    ];
  if (ts.isParenthesizedExpression(node))
    return emittedStrings(node.expression);
  return strings(node);
}
function journalCodes(file: ts.SourceFile): string[] {
  const codes: string[] = [];
  for (const entry of nodes(file, ts.isPropertyAssignment)) {
    if (entry.name.getText(file) !== 'code') continue;
    let container: ts.Node | undefined = entry.parent;
    while (
      container &&
      !ts.isStatement(container) &&
      !(
        ts.isPropertyAssignment(container) &&
        container.name.getText(file) === 'stop'
      )
    )
      container = container.parent;
    const tokens = emittedStrings(entry.initializer);
    if (container && ts.isPropertyAssignment(container))
      assertCovered(tokens, [
        ...RunEndReasonSchema.options,
        ...RunStopDetailSchema.options,
      ]);
    else codes.push(...tokens);
  }
  return codes;
}

function compact(node: ts.Node): string {
  return node.getText().replace(/\s+/g, '');
}
function assertBatchPause(file: ts.SourceFile, schema: string): void {
  const entry = nodes(declaration(file, schema), ts.isPropertyAssignment).find(
    (node) => ts.isIdentifier(node.name) && node.name.text === 'batchPause',
  );
  if (!entry) throw new Error('Missing batch-pause order field');
  expect(compact(entry.initializer)).toBe('z.boolean().default(true)');
}

function assertReloadBoundaryWait(
  file: ts.SourceFile,
  reloadWait: number,
): void {
  const reload = nodes(file, ts.isPropertyAssignment).find(
    (node) => node.name.getText(file) === 'waitMs',
  );
  if (!reload) throw new Error('Missing reload wait');
  let branch: ts.Node = reload;
  while (branch.parent && !ts.isBlock(branch)) branch = branch.parent;
  if (!ts.isBlock(branch)) throw new Error('Changed reload branch shape');
  const waits = nodes(branch, ts.isCallExpression).filter(
    (node) => node.expression.getText(file) === 'boundaryWait',
  );
  expect(waits).toHaveLength(1);
  const call = waits[0]!;
  expect(call.arguments).toHaveLength(1);
  if (!call.arguments[0] || !ts.isNumericLiteral(call.arguments[0]))
    throw new Error('Changed reload boundary-wait argument');
  expect(numberValue(call.arguments[0])).toBe(reloadWait);
  expect(compact(declaration(file, 'boundaryWait'))).toBe(
    'async(ms:number)=>{' +
      'if(controls)awaitcontrols.delay(' +
      'ms,(duration,signal)=>deps.sleep(duration,signal),' +
      'resumeChecks,mediaSignal,(remaining,next)=>options.session?.waiting(remaining,next),);' +
      'elseawaitdeps.sleep(ms,mediaSignal);}',
  );
}

async function paceInputs() {
  const x = await source('apps/cli/src/browser/pace.ts');
  const production = functionSource(x, 'productionPace');
  const comparisons = nodes(production, ts.isBinaryExpression)
    .filter((node) =>
      [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken].includes(
        node.operatorToken.kind,
      ),
    )
    .map((node) => node.getText(x).replace(/\s+/g, ''))
    .sort();
  expect(comparisons).toEqual(
    [
      'pace.batchSize<1',
      'pace.batchSize>floor.batchSize',
      'pace.intervalMs<floor.intervalMs',
      'pace.pauseMs<floor.pauseMs',
      'pace.perDay<1',
      'pace.perDay>floor.perDay',
      'v<0',
    ].sort(),
  );
  expect(
    nodes(production, ts.isCallExpression).map((node) =>
      node.getText(x).replace(/\s+/g, ''),
    ),
  ).toContain('Number.isSafeInteger(v)');
  const fill = await source('apps/cli/src/browser/x/fill/order.ts');
  const context = await source('apps/cli/src/browser/instagram/pace.ts');
  const order = await source('apps/cli/src/browser/instagram/order.ts');
  assertBatchPause(fill, 'FillOrderSchema');
  assertBatchPause(order, 'ContextOrderSchema');
  const fillPace = compact(functionSource(fill, 'orderPace'));
  for (const expression of [
    'order.value.secondsPerPage*1000',
    'perDay:order?.value.pagesPerDay??DEFAULT_FILL_PACE.perDay',
    'batch:DEFAULT_FILL_PACE.batch',
    'pauseMs:order?.value.batchPause===false?0:DEFAULT_FILL_PACE.pauseMs',
  ])
    expect(fillPace).toContain(expression);
  const contextPace = compact(functionSource(context, 'contextPace'));
  for (const expression of [
    'intervalMs:canary?CONTEXT_PACE.intervalMs:',
    'order.value.secondsPerStep*1000',
    'perDay:order?.value.stepsPerDay??CONTEXT_PACE.perDay',
    'pauseMs:order?.value.batchPause===false?0:base.pauseMs',
  ])
    expect(contextPace).toContain(expression);
  expect(compact(functionSource(context, 'instagramDailyCount'))).toContain(
    "run.platform==='instagram'&&run.accountKey===account",
  );
  const runner = await source('apps/cli/src/browser/runner.ts');
  const dailyCount = compact(functionSource(runner, 'dailyCount'));
  expect(dailyCount).toContain(
    'run.accountKey===account&&run.pageOpens!==undefined',
  );
  expect(dailyCount).not.toContain('run.mode');
  const windows = await source('apps/cli/src/browser/x/rate-windows.ts');
  const rateWait = rateWaitBound(windows);
  expect(compact(runner)).toContain('windows.beforeDeletion(');
  const deletion = await source('apps/cli/src/browser/x/delete-pace.ts');
  const stages = nodes(
    functionSource(deletion, 'deletionPace'),
    ts.isObjectLiteralExpression,
  ).map(numericProperties);
  expect(stages).toHaveLength(3);
  expect(compact(functionSource(deletion, 'deletionPace'))).toContain(
    'windows.permitsFastDeletion(now)',
  );
  expect(compact(declaration(runner, 'effectivePace'))).toContain(
    'deletionPace(cleanDeletions(',
  );
  expect(compact(declaration(runner, 'effectivePace'))).toContain(
    'dependencies.pace.intervalMs*stage.intervalMs',
  );
  expect(compact(declaration(runner, 'effectivePace'))).toContain(
    'perDay:Math.min(stage.perDay,',
  );
  const fillRun = await source('apps/cli/src/browser/x/fill/run.ts');
  expect(declaration(fillRun, 'FILL_PACE').getText(fillRun)).toBe(
    'DEFAULT_FILL_PACE',
  );
  expect(compact(declaration(fillRun, 'dayCap'))).toBe('effectivePace.perDay');
  expect(compact(declaration(fillRun, 'effectivePace'))).toBe(
    'orderPace(options.order)',
  );
  expect(compact(fillRun)).toContain(
    'run.accountKey===options.plan.accountKey&&run.pageOpens!==undefined',
  );
  expect(compact(fillRun)).toContain('windows.beforePage(');
  const reload = nodes(fillRun, ts.isPropertyAssignment).find(
    (node) => node.name.getText(fillRun) === 'waitMs',
  );
  if (!reload) throw new Error('Missing reload wait');
  const reloadWait = numberValue(reload.initializer);
  const reloadCount = nodes(fillRun, ts.isBinaryExpression).find(
    (node) =>
      node.left.getText(fillRun) === 'reloadCount' &&
      node.operatorToken.kind === ts.SyntaxKind.LessThanToken,
  );
  if (!reloadCount) throw new Error('Missing reload count bound');
  expect(numberValue(reloadCount.right)).toBe(3);
  expect(compact(reloadCount.parent)).toContain('!options.plan.canary');
  assertReloadBoundaryWait(fillRun, reloadWait);
  return {
    delete: { pace: numericObject(x, 'DELETE_PACE'), seconds: null, cap: null },
    verify: { pace: numericObject(x, 'VERIFY_PACE'), seconds: null, cap: null },
    fill: {
      pace: numericObject(fill, 'DEFAULT_FILL_PACE'),
      seconds: orderBounds(fill, 'FillOrderSchema', 'secondsPerPage'),
      cap: orderBounds(fill, 'FillOrderSchema', 'pagesPerDay'),
    },
    context: {
      pace: numericObject(context, 'CONTEXT_PACE'),
      seconds: orderBounds(order, 'ContextOrderSchema', 'secondsPerStep'),
      cap: orderBounds(order, 'ContextOrderSchema', 'stepsPerDay'),
    },
    rateWait,
    reloadWait,
    deletionStages: stages,
  };
}

test.each([
  ['reload literal', 'boundaryWait(60000)', 'boundaryWait(59999)'],
  ['controls delay', 'controls.delay(', 'deps.sleep('],
] as const)(
  'reload producer tie rejects a changed %s',
  async (_name, oldText, newText) => {
    const fill = await source('apps/cli/src/browser/x/fill/run.ts');
    const changed = fill.text.replace(oldText, newText);
    expect(changed).not.toBe(fill.text);
    expect(() => assertReloadBoundaryWait(parse(changed), 60000)).toThrow();
  },
);

test.each([
  ['reading reserve', 'this.before(now, 0)', 'this.before(now, 1)'],
  ['deletion reserve', 'this.before(now, 1)', 'this.before(now, 0)'],
] as const)(
  'shared rate-window producer tie rejects a changed %s',
  async (_name, oldText, newText) => {
    const windows = await source('apps/cli/src/browser/x/rate-windows.ts');
    const changed = windows.text.replace(oldText, newText);
    expect(changed).not.toBe(windows.text);
    expect(() => rateWaitBound(parse(changed))).toThrow();
  },
);

test('shared rate-window producer wait bounds remain tied to the desktop ceiling', async () => {
  const windows = await source('apps/cli/src/browser/x/rate-windows.ts');
  const inputs = await paceInputs();
  for (const [oldText, newText] of [
    ['16 * 60000', '17 * 60000'],
    ['+ 5000', '+ 5001'],
  ]) {
    const changed = windows.text.replace(oldText!, newText!);
    expect(changed).not.toBe(windows.text);
    const maximum = rateWaitBound(parse(changed));
    expect(maximum).toBeGreaterThan(inputs.rateWait);
    expect(
      RunViewSchema.safeParse({
        ...projection('fill', inputs.fill),
        phase: 'rate-wait',
        remainingMs: maximum,
        resetAt: '2026-10-16T12:00:00.000Z',
      }).success,
    ).toBe(false);
  }
});

function projection(
  mode: DesktopRunMode,
  input: { pace: Record<string, number> },
) {
  const { pace } = input;
  const instagram = mode === 'context';
  return {
    phase: 'running',
    version: 1,
    runId: 'generated-pace-run',
    platform: instagram ? 'instagram' : 'x',
    mode,
    accountKey: `${instagram ? 'instagram' : 'x'}:generated`,
    expectedHandle: 'generated',
    planHash: 'a'.repeat(64),
    canary: false,
    pauseRequested: false,
    progress: {
      planned: 0,
      completed: 0,
      marked: 0,
      bulk: 0,
      settled: {
        withdrawn: 0,
        deleted: 0,
        'not-found': 0,
        failed: 0,
        ambiguous: 0,
        'not-deleted': 0,
        'still-gone': 0,
        reappeared: 0,
        read: 0,
        tombstone: 0,
        unavailable: 0,
        confirmed: 0,
        unconfirmed: 0,
        'not-listed': 0,
      },
    },
    today: {
      date: '2026-10-16',
      timeZone: 'Europe/Berlin',
      used: 0,
      cap: pace.perDay!,
      unit: instagram ? 'steps' : 'pages',
      sharedWithXDeleteAndFill: !instagram,
    },
    pace: {
      secondsPerStep: pace.intervalMs! / 1000,
      batchSize: pace.batchSize ?? pace.batch!,
      batchPauseMs: pace.pauseMs!,
    },
    nextStepAt: null,
    currentEntry: null,
    journal: [],
    xWindows: [],
    instagram: null,
    warning: { form: 'full', acknowledged: true, text: 'Generated warning' },
    profile: {
      canChange: ['Generated profile change'],
      before: null,
      readback: null,
    },
    browserWindow: null,
  };
}

test.each(['delete', 'verify', 'fill', 'context'] as const)(
  'pace default projection: %s',
  async (mode) => {
    const input = await paceInputs();
    const view = projection(mode, input[mode]);
    expect(RunViewSchema.parse(view)).toEqual(view);
    expect(
      RunViewSchema.safeParse({
        ...view,
        phase: 'batch-pause',
        remainingMs: view.pace.batchPauseMs,
        until: '2026-10-16T12:00:00.000Z',
      }),
    ).toMatchObject({ success: true });
    if (mode === 'fill' || mode === 'delete') {
      expect(
        RunViewSchema.safeParse({
          ...view,
          phase: 'rate-wait',
          remainingMs: input.rateWait,
          resetAt: '2026-10-16T12:00:00.000Z',
        }),
      ).toMatchObject({ success: true });
    }
    if (mode === 'fill') {
      expect(
        RunViewSchema.safeParse({
          ...view,
          phase: 'reload-wait',
          remainingMs: input.reloadWait,
          until: '2026-10-16T12:00:00.000Z',
          reload: 3,
        }),
      ).toMatchObject({ success: true });
    }
  },
);

test('all deletion stage projections and cap boundaries come from the staged pace producer', async () => {
  const inputs = await paceInputs();
  for (const stage of inputs.deletionStages) {
    const view = projection('delete', {
      pace: { ...inputs.delete.pace, ...stage },
    });
    expect(RunViewSchema.safeParse(view).success).toBe(true);
    expect(
      RunViewSchema.safeParse({
        ...view,
        today: { ...view.today, cap: stage.perDay! + 1 },
      }).success,
    ).toBe(false);
  }
});

test.each(['delete', 'verify', 'fill', 'context'] as const)(
  'pace producer bounds: %s admits endpoints and rejects outside values',
  async (mode) => {
    const inputs = await paceInputs();
    const input = inputs[mode];
    const view = projection(mode, input);
    const fixed = input.seconds !== null;
    const min =
      input.seconds?.min ??
      (mode === 'delete'
        ? Math.min(...inputs.deletionStages.map((stage) => stage.intervalMs!)) /
          1000
        : input.pace.intervalMs! / 1000);
    const max = input.seconds?.max ?? Number.MAX_SAFE_INTEGER / 1000;
    const batch = view.pace.batchSize;
    const cap = input.cap?.max ?? input.pace.perDay!;
    const validPaces = [
      { ...view.pace, secondsPerStep: min },
      { ...view.pace, secondsPerStep: max },
      { ...view.pace, batchSize: fixed ? batch : 1 },
      { ...view.pace, batchPauseMs: fixed ? 0 : Number.MAX_SAFE_INTEGER },
    ];
    if (!fixed)
      validPaces.push({
        ...view.pace,
        secondsPerStep: (input.pace.intervalMs! + 1) / 1000,
      });
    for (const pace of validPaces)
      expect(
        RunViewSchema.safeParse({ ...view, pace }).success,
        `${mode}/${JSON.stringify(pace)}`,
      ).toBe(true);
    if (mode === 'context') {
      expect(RunViewSchema.safeParse({ ...view, canary: true }).success).toBe(
        true,
      );
      expect(
        RunViewSchema.safeParse({
          ...view,
          canary: true,
          pace: { ...view.pace, secondsPerStep: min },
        }).success,
      ).toBe(false);
    }
    for (const pace of [
      { ...view.pace, secondsPerStep: min - 1 },
      { ...view.pace, secondsPerStep: min - 0.001 },
      { ...view.pace, secondsPerStep: max + 1 },
      { ...view.pace, batchSize: batch + 1 },
      { ...view.pace, batchSize: fixed ? batch - 1 : 0 },
      { ...view.pace, batchPauseMs: fixed ? 1 : input.pace.pauseMs! - 1 },
      { ...view.pace, batchPauseMs: -1 },
      { ...view.pace, batchPauseMs: Number.MAX_SAFE_INTEGER + 1 },
      ...(fixed
        ? [{ ...view.pace, batchPauseMs: input.pace.pauseMs! + 1 }]
        : [{ ...view.pace, secondsPerStep: min + 0.0001 }]),
      ...(fixed ? [{ ...view.pace, secondsPerStep: min + 0.5 }] : []),
    ])
      expect(
        RunViewSchema.safeParse({ ...view, pace }).success,
        `${mode}/${JSON.stringify(pace)}`,
      ).toBe(false);
    const minCap = input.cap?.min ?? 1;
    for (const value of [minCap, cap])
      expect(
        RunViewSchema.safeParse({
          ...view,
          today: { ...view.today, cap: value },
        }).success,
        `${mode}/cap ${value}`,
      ).toBe(true);
    for (const today of [
      { ...view.today, cap: cap + 1 },
      { ...view.today, cap: minCap - 1 },
      { ...view.today, unit: view.today.unit === 'pages' ? 'steps' : 'pages' },
      {
        ...view.today,
        sharedWithXDeleteAndFill: !view.today.sharedWithXDeleteAndFill,
      },
    ])
      expect(RunViewSchema.safeParse({ ...view, today }).success, mode).toBe(
        false,
      );
    const until = '2026-10-16T12:00:00.000Z';
    expect(
      RunViewSchema.safeParse({
        ...view,
        phase: 'batch-pause',
        remainingMs: view.pace.batchPauseMs + 1,
        until,
      }).success,
      mode,
    ).toBe(false);
    const longestPause = fixed ? input.pace.pauseMs! : Number.MAX_SAFE_INTEGER;
    expect(
      RunViewSchema.safeParse({
        ...view,
        pace: { ...view.pace, batchPauseMs: longestPause },
        phase: 'batch-pause',
        remainingMs: longestPause,
        until,
      }).success,
      mode,
    ).toBe(true);
    for (const [phase, maximum] of [
      ['rate-wait', inputs.rateWait],
      ['reload-wait', inputs.reloadWait],
    ] as const) {
      for (const remainingMs of [0, maximum, maximum + 1])
        expect(
          RunViewSchema.safeParse({
            ...view,
            phase,
            remainingMs,
            ...(phase === 'rate-wait'
              ? { resetAt: until }
              : { until, reload: 3 }),
          }).success,
          `${mode}/${phase}/${remainingMs}`,
        ).toBe(
          (mode === 'fill' || (mode === 'delete' && phase === 'rate-wait')) &&
            remainingMs <= maximum,
        );
    }
    if (mode === 'fill')
      expect(
        RunViewSchema.safeParse({
          ...view,
          canary: true,
          phase: 'reload-wait',
          remainingMs: inputs.reloadWait,
          until,
          reload: 1,
        }).success,
      ).toBe(false);
  },
);

test('source lists cannot gain a CLI error or stop token without a desktop schema update', async () => {
  const errors = await source('apps/cli/src/cli/errors.ts');
  expect(registryKeys(errors, 'CLI_ERRORS').sort()).toEqual(
    [...DesktopCliErrorCodeSchema.options].sort(),
  );
  expect([...new Set(DesktopErrorCodeSchema.options)].sort()).toEqual(
    [
      ...new Set([
        ...registryKeys(errors, 'CLI_ERRORS'),
        ...WORKSPACE_ERROR_CODES,
        ...desktopOnlyCodes,
      ]),
    ].sort(),
  );
  for (const code of desktopOnlyCodes)
    expect(DesktopCliErrorCodeSchema.safeParse(code).success).toBe(false);
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

test('guide link red control: a producer error missing from the desktop error list trips coverage', async () => {
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
      DesktopErrorCodeSchema.options,
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
    codes.push(...journalCodes(file));
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
      .filter((value) =>
        ['no-row', 'window-full', 'list-image-only'].includes(value),
      ),
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

test('conditional journal-code arms stay closed without treating input discriminants as emitted codes', () => {
  const file = parse(`
    writer.record({ code: active.mode === 'delete' || active.mode === 'verify'
      ? 'PROCESS_LOST' : 'INTERRUPTED' });
    JSON.stringify({ stop: detail ?? (longWindow
      ? { code: 'daily-cap', reason: 'x-window-long' } : null) });
  `);
  expect(journalCodes(file)).toEqual(['PROCESS_LOST', 'INTERRUPTED']);
  assertCovered(journalCodes(file), RunJournalCodeSchema.options);
  expect(() =>
    assertCovered(
      journalCodes(parse(file.text.replace("'INTERRUPTED'", "'NEW_CODE'"))),
      RunJournalCodeSchema.options,
    ),
  ).toThrow('Producer tokens missing');
  expect(() =>
    journalCodes(parse(file.text.replace("'daily-cap'", "'new-stop-code'"))),
  ).toThrow('Producer tokens missing');
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
  const windows = await source('apps/cli/src/browser/x/rate-windows.ts');
  const groups = strings(declaration(windows, 'operation')).filter((token) =>
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
