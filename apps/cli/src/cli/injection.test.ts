import { expect, test } from 'vitest';
import { createNodeContext } from './node-context.ts';
import { capturedContext } from './test/context.ts';
import { CliError } from './errors.ts';
import { executeCli } from './adapter.ts';
import {
  injectionArchive,
  injectionInput,
  assertNoFixtureStrings,
  assertFailureCases,
} from './test/injection-harness.ts';
import type { FailingCommandCase } from './test/injection-harness.ts';
import type { CliContext } from './context.ts';
import type { PlatformGuide } from '@socialprune/core/guide/types';

test('injection output oracle rejects each fixture string on either stream', async () => {
  const input = await injectionInput();
  expect(input.forbidden.length).toBeGreaterThan(5);
  for (const value of input.forbidden) {
    expect(() => assertNoFixtureStrings(value, '', input.forbidden)).toThrow();
    expect(() => assertNoFixtureStrings('', value, input.forbidden)).toThrow();
  }
});

test('every C1 failure path rejects fixture data without echoing or executing it', async () => {
  const input = await injectionInput();
  const capture = capturedContext({
    guides: [],
    describeStructure() {
      return Promise.reject(new Error('Unused'));
    },
    listSchemas() {
      return Promise.resolve([]);
    },
  });
  const node = createNodeContext(
    capture.context.io.stdout,
    capture.context.io.stderr,
  );
  const throwRaw = () => {
    throw new Error(input.text);
  };
  const services: CliContext['services'] = {
    ...node.services,
    describeStructure: throwRaw,
    listSchemas: throwRaw,
  };
  const cases: FailingCommandCase[] = [
    {
      name: 'structure missing path',
      args: ['structure'],
      services,
      exitCode: 2,
    },
    {
      name: 'structure invalid path',
      args: ['structure', input.text],
      services: node.services,
      exitCode: 2,
    },
    {
      name: 'structure parser value',
      args: ['structure', injectionArchive, `--${input.text}`],
      services,
      exitCode: 2,
    },
    {
      name: 'structure raw service exception',
      args: ['structure', injectionArchive],
      services,
      exitCode: 1,
    },
    {
      name: 'structure typed invalid path',
      args: ['structure', injectionArchive],
      services: {
        ...services,
        describeStructure() {
          throw new CliError('INVALID_ARCHIVE_PATH');
        },
      },
      exitCode: 2,
    },
    { name: 'guide missing platform', args: ['guide'], services, exitCode: 2 },
    {
      name: 'guide untrusted platform',
      args: ['guide', input.text],
      services,
      exitCode: 2,
    },
    {
      name: 'guide untrusted language',
      args: ['guide', 'x', '--lang', input.text],
      services,
      exitCode: 2,
    },
    { name: 'guide unavailable', args: ['guide', 'x'], services, exitCode: 2 },
    {
      name: 'guide untrusted extra',
      args: ['guide', 'x', input.text],
      services,
      exitCode: 2,
    },
    {
      name: 'guide raw source exception',
      args: ['guide', 'x'],
      services: {
        ...services,
        get guides(): readonly PlatformGuide[] {
          throw new Error(input.text);
        },
      },
      exitCode: 1,
    },
    {
      name: 'schemas untrusted positional',
      args: ['schemas', input.text],
      services,
      exitCode: 2,
    },
    {
      name: 'schemas untrusted flag',
      args: ['schemas', `--${input.text}`],
      services,
      exitCode: 2,
    },
    {
      name: 'schemas raw provider exception',
      args: ['schemas'],
      services,
      exitCode: 1,
    },
    { name: 'scan unavailable', args: ['scan'], services, exitCode: 2 },
    {
      name: 'scan unexpected text',
      args: ['scan', input.text],
      services,
      exitCode: 2,
    },
    { name: 'mcp unavailable', args: ['mcp'], services, exitCode: 2 },
    {
      name: 'mcp untrusted flag',
      args: ['mcp', `--${input.text}`],
      services,
      exitCode: 2,
    },
    {
      name: 'review unavailable',
      args: ['review', '--workspace', input.text, '--dry-run'],
      services,
      exitCode: 2,
    },
    {
      name: 'review untrusted flag',
      args: ['review', `--${input.text}`],
      services,
      exitCode: 2,
    },
    { name: 'untrusted route', args: [input.text], services, exitCode: 2 },
    {
      name: 'untrusted root flag',
      args: [`--${input.text}`],
      services,
      exitCode: 2,
    },
  ];
  const before: unknown = Reflect.get(globalThis, input.marker);
  await assertFailureCases(cases, input.forbidden);
  expect(Reflect.get(globalThis, input.marker)).toBe(before);
});

test('real structure inspection of the injection export remains inert and value-free', async () => {
  const input = await injectionInput();
  const capture = capturedContext({
    guides: [],
    describeStructure() {
      return Promise.reject(new Error('Unused'));
    },
    listSchemas() {
      return Promise.resolve([]);
    },
  });
  const node = createNodeContext(
    capture.context.io.stdout,
    capture.context.io.stderr,
  );
  const before: unknown = Reflect.get(globalThis, input.marker);
  expect(
    await executeCli(['structure', injectionArchive, '--json'], node),
  ).toBe(0);
  assertNoFixtureStrings(
    capture.stdout.join(''),
    capture.stderr.join(''),
    input.forbidden.filter((value) => value !== 'data/tweets.js'),
  );
  expect(Reflect.get(globalThis, input.marker)).toBe(before);
});
