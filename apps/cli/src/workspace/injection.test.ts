import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { CliContext } from '../cli/context.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { executeCli } from '../cli/adapter.ts';
import { capturedContext } from '../cli/test/context.ts';
import {
  assertFailureCases,
  assertNoFixtureStrings,
  injectionArchive,
  injectionInput,
} from '../cli/test/injection-harness.ts';
import type { FailingCommandCase } from '../cli/test/injection-harness.ts';
import { CliError } from '../cli/errors.ts';

test('every C2 command error class contains no injection fixture values and never executes them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-injection-'));
  const workspace = join(directory, 'workspace');
  const badFile = join(directory, 'invalid.json');
  const out = join(directory, 'out.json');
  const input = await injectionInput();
  const services = createNodeContext({ write() {} }, { write() {} }).services;
  const before: unknown = Reflect.get(globalThis, input.marker);
  try {
    await writeFile(badFile, input.text);
    const routes = [
      {
        route: ['import'],
        valid: ['import', injectionArchive, '--workspace', workspace],
        method: 'importWorkspace',
      },
      {
        route: ['summary'],
        valid: ['summary', '--workspace', workspace],
        method: 'summarizeWorkspace',
      },
      {
        route: ['review'],
        valid: ['review', '--workspace', workspace, '--dry-run'],
        method: 'summarizeWorkspace',
      },
      {
        route: ['backup', 'export'],
        valid: ['backup', 'export', '--workspace', workspace, '--out', out],
        method: 'exportBackup',
      },
      {
        route: ['backup', 'restore'],
        valid: ['backup', 'restore', badFile, '--workspace', workspace],
        method: 'restoreWorkspace',
      },
      {
        route: ['export', 'clicklist'],
        valid: [
          'export',
          'clicklist',
          '--workspace',
          workspace,
          '--account',
          'x:generated',
          '--out',
          out,
        ],
        method: 'exportClickList',
      },
    ];
    const cases: FailingCommandCase[] = [];
    for (const command of routes) {
      for (const [name, args] of [
        ['missing argument', command.route],
        ['untrusted flag', [...command.valid, `--${input.text}`]],
      ] as const)
        cases.push({
          name: `${command.method} ${name}`,
          args,
          services,
          exitCode: 2,
          envelope: true,
        });
      cases.push({
        name: `${command.method} old Node`,
        args: command.valid,
        services,
        nodeVersion: '24.14.1',
        exitCode: 1,
        envelope: true,
      });
      for (const error of [
        new Error(input.text),
        new CliError('WORKSPACE_BUSY'),
        new CliError('STORAGE_FULL'),
        new CliError('WORKSPACE_SCHEMA_UNSUPPORTED'),
      ]) {
        const failing = {
          ...services,
          workspace: {
            ...services.workspace!,
            [command.method]: () => {
              throw error;
            },
          },
        } as CliContext['services'];
        cases.push({
          name: `${command.method} service ${error.name}`,
          args: command.valid,
          services: failing,
          exitCode:
            error instanceof CliError
              ? error.code === 'WORKSPACE_SCHEMA_UNSUPPORTED'
                ? 3
                : 1
              : 1,
          envelope: true,
        });
      }
    }
    cases.push(
      {
        name: 'import untrusted path',
        args: ['import', input.text, '--workspace', workspace],
        services,
        exitCode: 2,
        envelope: true,
      },
      {
        name: 'summary untrusted workspace',
        args: ['summary', '--workspace', input.text],
        services,
        exitCode: 2,
        envelope: true,
      },
      {
        name: 'restore actual injection file',
        args: ['backup', 'restore', badFile, '--workspace', workspace],
        services,
        exitCode: 1,
        envelope: true,
      },
      {
        name: 'export untrusted format',
        args: [
          'export',
          'clicklist',
          '--workspace',
          workspace,
          '--account',
          'x:generated',
          '--out',
          out,
          '--format',
          input.text,
        ],
        services,
        exitCode: 2,
        envelope: true,
      },
      {
        name: 'backup untrusted destination',
        args: [
          'backup',
          'export',
          '--workspace',
          workspace,
          '--out',
          input.text,
        ],
        services,
        exitCode: 1,
        envelope: true,
      },
    );
    await assertFailureCases(cases, input.forbidden);
    expect(Reflect.get(globalThis, input.marker)).toBe(before);
    // Exercise the real parser failure, not only exception injection.
    const capture = capturedContext(services);
    const result = await executeCli(
      ['import', injectionArchive, '--workspace', workspace, '--json'],
      capture.context,
    );
    expect(result).toBe(4);
    assertNoFixtureStrings(
      capture.stdout.join(''),
      capture.stderr.join(''),
      input.forbidden,
    );
    expect(Reflect.get(globalThis, input.marker)).toBe(before);
    // Fail-closed non-empty-folder behavior with untrusted input remains a fixed error.
    const foreign = join(directory, 'nonempty');
    await mkdir(foreign);
    await writeFile(join(foreign, 'generated.txt'), input.text);
    await assertFailureCases(
      [
        {
          name: 'nonempty workspace',
          args: ['import', injectionArchive, '--workspace', foreign],
          services,
          exitCode: 2,
          envelope: true,
        },
      ],
      input.forbidden,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
