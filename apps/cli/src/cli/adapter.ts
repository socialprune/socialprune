import {
  buildApplication,
  buildRouteMap,
  help,
  run,
  text_en,
} from '@stricli/core';
import type { Command } from '@stricli/core';
import { reportNotice } from '../commands/structure.ts';
import type { CliContext, CommandReply, CommandRunContext } from './context.ts';
import { CliError, errorObject, normalizeExitCode } from './errors.ts';
import type { CliErrorCode, ExitCode } from './errors.ts';
import { plainLines, writeFailure, writeReply } from './output.ts';
import { commandRegistry, machineHelp } from './registry.ts';
import type { RegistryEntry } from './registry.ts';

function requestedJson(args: readonly string[]): boolean {
  const escape = args.indexOf('--');
  return (escape < 0 ? args : args.slice(0, escape)).some(
    (arg) => arg === '--json' || arg === '--json=true',
  );
}

function hasMalformedSwitch(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === '--') break;
    if (
      arg.startsWith('--') &&
      !/^--[a-zA-Z][a-zA-Z\d_.-]*(?:=[^\r\n]*)?$/.test(arg)
    )
      return true;
    if (
      arg.startsWith('-') &&
      !arg.startsWith('--') &&
      arg !== '-' &&
      !/^-[a-zA-Z]+$/.test(arg)
    )
      return true;
  }
  return false;
}

export async function executeCli(
  args: readonly string[],
  context: CliContext,
): Promise<ExitCode> {
  const json = requestedJson(args);
  const entries = commandRegistry();
  let selected: RegistryEntry | undefined = entries.find((entry) =>
    entry.path.every((part, index) => part === args[index]),
  );
  let reply: CommandReply | undefined;
  let failure: CliErrorCode | undefined;
  let failureNodeVersion: string | undefined;
  let frameworkExit = 0;
  let helpOutput = '';
  let isHelp = false;
  const captureFailure = (code: CliErrorCode): string => {
    failure = code;
    return errorObject(code).message;
  };
  const failFromException = (error: unknown): string => {
    if (error instanceof CliError) failureNodeVersion = error.nodeVersion;
    return captureFailure(
      context.signal.aborted
        ? 'CANCELLED'
        : error instanceof CliError
          ? error.code
          : (selected?.failureCode ?? 'CLI_ERROR'),
    );
  };
  const helpIntegration = help<CommandRunContext>({
    brief: 'Print help information and exit',
    formatting: {
      caseStyle: 'convert-camel-to-kebab',
      useAliasInUsageLine: false,
      onlyRequiredInUsageLine: false,
    },
  });
  const routes: Record<
    string,
    | Command<CommandRunContext>
    | ReturnType<typeof buildRouteMap<string, CommandRunContext>>
  > = {};
  for (const entry of entries.filter((value) => value.path.length === 1))
    routes[entry.path[0]!] = entry.command;
  for (const root of new Set(
    entries
      .filter((value) => value.path.length === 2)
      .map((value) => value.path[0]!),
  )) {
    const children: typeof routes = {};
    for (const entry of entries.filter(
      (value) => value.path.length === 2 && value.path[0] === root,
    ))
      children[entry.path[1]!] = entry.command;
    routes[root] = buildRouteMap({
      routes: children,
      docs: {
        brief:
          root === 'backup' ? 'Portable JSON backups' : 'Workspace exports',
      },
    });
  }
  const application = buildApplication(
    buildRouteMap({
      routes,
      docs: { brief: 'SocialPrune', fullDescription: reportNotice },
    }),
    {
      name: 'socialprune',
      scanner: {
        caseStyle: 'allow-kebab-for-camel',
        allowArgumentEscapeSequence: true,
      },
      documentation: { disableAnsiColor: true },
      localization: {
        text: {
          ...text_en,
          formatException: () => errorObject('CLI_ERROR').message,
          noCommandRegisteredForInput: () =>
            captureFailure('INVALID_ARGUMENTS'),
          exceptionWhileParsingArguments: () =>
            captureFailure('INVALID_ARGUMENTS'),
          exceptionWhileLoadingCommandFunction: () =>
            captureFailure('CLI_ERROR'),
          exceptionWhileLoadingCommandContext: () =>
            captureFailure('CLI_ERROR'),
          exceptionWhileRunningCommand: failFromException,
          commandErrorResult: failFromException,
          exceptionWhileRunningIntegrationHook: () =>
            captureFailure('CLI_ERROR'),
          exceptionWhileRunningIntegrationFlag: ({ exception }) =>
            failFromException(exception),
        },
      },
      determineExitCode(error) {
        failFromException(error);
        return errorObject(failure ?? 'CLI_ERROR').exitCode;
      },
      // No versionInfo or version integration: no automatic network checker.
    },
    {
      help: {
        ...helpIntegration,
        flag: {
          ...helpIntegration.flag!,
          async run(application, info) {
            isHelp = true;
            selected = entries.find(
              (entry) => entry.command === info.result.target,
            );
            for (const arg of info.result.unprocessedInputs) {
              if (arg === '--') break;
              if (!arg.startsWith('-') || arg === '-') continue;
              const name = arg.split('=', 1)[0]!.replace(/^--/, '');
              if (
                !selected ||
                !selected.command.usesFlag(name, 'allow-kebab-for-camel')
              )
                throw new CliError('INVALID_ARGUMENTS');
            }
            await helpIntegration.flag!.run.call(this, application, info);
          },
        },
      },
    },
  );
  const frameworkProcess = {
    stdout: {
      write(text: string) {
        helpOutput += text;
      },
    },
    // Framework diagnostics can echo arguments; only our fixed table leaves the adapter.
    stderr: { write(_text: string) {} },
    set exitCode(code: number | string | null | undefined) {
      frameworkExit = typeof code === 'number' ? normalizeExitCode(code) : 1;
    },
  };
  try {
    context.signal.throwIfAborted();
    if (hasMalformedSwitch(args)) throw new CliError('INVALID_ARGUMENTS');
    const escape = args.indexOf('--');
    const helpRequested = (escape < 0 ? args : args.slice(0, escape)).some(
      (arg) => arg === '--help' || arg === '-h',
    );
    const inputs = helpRequested
      ? args.filter((arg) => arg !== '--json' && arg !== '--json=true')
      : args;
    await run(application, inputs, {
      process: frameworkProcess,
      forCommand(info): CommandRunContext {
        selected = entries.find(
          (entry) => entry.path.join('.') === info.prefix.slice(1).join('.'),
        );
        return {
          ...context,
          process: frameworkProcess,
          reply(result) {
            if (reply) throw new CliError('CLI_ERROR');
            reply = result;
          },
        };
      },
    });
  } catch (error) {
    failFromException(error);
  }
  const command = selected?.path.join('.') ?? 'socialprune';
  if (failure || frameworkExit !== 0) {
    const code =
      failure ?? (frameworkExit === 2 ? 'INVALID_ARGUMENTS' : 'CLI_ERROR');
    writeFailure(
      context,
      command,
      json,
      code,
      failureNodeVersion,
      selected?.envelope,
    );
    return errorObject(code).exitCode;
  }
  if (reply) {
    try {
      writeReply(context, command, json, reply);
      return normalizeExitCode(reply.exitCode ?? 0);
    } catch {
      writeFailure(
        context,
        command,
        json,
        'CLI_ERROR',
        undefined,
        selected?.envelope,
      );
      return 1;
    }
  }
  if (isHelp || helpOutput) {
    if (json) {
      try {
        const schemaIds = new Set(
          (await context.services.listSchemas(context.signal)).map(
            (schema) => schema.id,
          ),
        );
        writeReply(context, command, true, {
          data: machineHelp(entries, schemaIds, selected),
          human: '',
        });
      } catch {
        writeFailure(context, command, true, 'SCHEMAS_FAILED');
        return 1;
      }
    } else context.io.stdout.write(plainLines(helpOutput));
    return 0;
  }
  writeFailure(context, command, json, 'INVALID_ARGUMENTS');
  return 2;
}
