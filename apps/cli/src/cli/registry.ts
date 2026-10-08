import { buildCommand } from '@stricli/core';
import type { Command } from '@stricli/core';
import { guideCommand } from '../commands/guide.ts';
import { schemasCommand } from '../commands/schemas.ts';
import { structureCommand } from '../commands/structure.ts';
import { importCommand } from '../commands/import.ts';
import { summaryCommand } from '../commands/summary.ts';
import { backupExportCommand } from '../commands/backup-export.ts';
import { backupRestoreCommand } from '../commands/backup-restore.ts';
import { clickListCommand } from '../commands/export-clicklist.ts';
import { reviewCommand } from '../commands/review.ts';
import { batchNextCommand } from '../commands/batch-next.ts';
import { labelsSubmitCommand } from '../commands/labels-submit.ts';
import { jsonFlag } from './context.ts';
import type { CommandRunContext } from './context.ts';
import { CliError, EXIT_MEANINGS } from './errors.ts';
import type { CliErrorCode } from './errors.ts';
import { CliHelpSchema, CLI_SCHEMA_IDS } from './schemas.ts';

export interface RegistryEntry {
  path: readonly string[];
  command: Command<CommandRunContext>;
  writes: boolean;
  dryRun: boolean;
  available: boolean;
  outputSchemaIds: readonly string[];
  failureCode: CliErrorCode;
  envelope?: boolean;
}

function unavailableCommand(): Command<CommandRunContext> {
  return buildCommand({
    parameters: { flags: { json: jsonFlag } },
    docs: { brief: 'Not available in this version (NOT_AVAILABLE)' },
    func(
      this: CommandRunContext,
      _flags: {
        json: boolean;
      },
    ) {
      throw new CliError('NOT_AVAILABLE');
    },
  });
}

export function commandRegistry(): readonly RegistryEntry[] {
  return [
    {
      path: ['guide'],
      command: guideCommand,
      writes: false,
      dryRun: false,
      available: false,
      outputSchemaIds: [CLI_SCHEMA_IDS.result],
      failureCode: 'CLI_ERROR',
    },
    {
      path: ['structure'],
      command: structureCommand,
      writes: false,
      dryRun: false,
      available: true,
      outputSchemaIds: [CLI_SCHEMA_IDS.result],
      failureCode: 'STRUCTURE_FAILED',
    },
    {
      path: ['schemas'],
      command: schemasCommand,
      writes: false,
      dryRun: false,
      available: true,
      outputSchemaIds: [CLI_SCHEMA_IDS.result],
      failureCode: 'SCHEMAS_FAILED',
    },
    ...['scan', 'mcp'].map((name) => ({
      path: [name],
      command: unavailableCommand(),
      writes: false,
      dryRun: false,
      available: false,
      outputSchemaIds: [CLI_SCHEMA_IDS.result],
      failureCode: 'NOT_AVAILABLE' as const,
    })),
    {
      path: ['batch', 'next'],
      command: batchNextCommand,
      writes: false,
      dryRun: false,
      available: true,
      outputSchemaIds: [
        CLI_SCHEMA_IDS.result,
        'https://socialprune.github.io/socialprune/schemas/batch.schema.json',
      ],
      failureCode: 'BATCH_FAILED',
    },
    {
      path: ['labels', 'submit'],
      command: labelsSubmitCommand,
      writes: true,
      dryRun: true,
      available: true,
      outputSchemaIds: [
        CLI_SCHEMA_IDS.result,
        'https://socialprune.github.io/socialprune/schemas/label-submission.schema.json',
      ],
      failureCode: 'LABELS_FAILED',
    },
    {
      path: ['review'],
      command: reviewCommand,
      writes: false,
      dryRun: true,
      available: true,
      envelope: true,
      outputSchemaIds: [CLI_SCHEMA_IDS.result],
      failureCode: 'REVIEW_FAILED',
    },
    ...[
      {
        path: ['import'],
        command: importCommand,
        writes: true,
        dryRun: true,
        failureCode: 'IMPORT_FAILED' as const,
      },
      {
        path: ['summary'],
        command: summaryCommand,
        writes: false,
        dryRun: false,
        failureCode: 'SUMMARY_FAILED' as const,
      },
      {
        path: ['backup', 'export'],
        command: backupExportCommand,
        writes: true,
        dryRun: true,
        failureCode: 'BACKUP_FAILED' as const,
      },
      {
        path: ['backup', 'restore'],
        command: backupRestoreCommand,
        writes: true,
        dryRun: true,
        failureCode: 'BACKUP_FAILED' as const,
      },
      {
        path: ['export', 'clicklist'],
        command: clickListCommand,
        writes: true,
        dryRun: true,
        failureCode: 'EXPORT_FAILED' as const,
      },
    ].map((entry) => ({
      ...entry,
      available: true,
      envelope: true,
      outputSchemaIds: [
        CLI_SCHEMA_IDS.result,
        ...(entry.path[0] === 'summary'
          ? [
              'https://socialprune.github.io/socialprune/schemas/summary.schema.json',
            ]
          : []),
      ],
    })),
  ];
}

export function machineHelp(
  entries: readonly RegistryEntry[],
  schemaIds: ReadonlySet<string>,
  selected?: RegistryEntry,
) {
  return CliHelpSchema.parse({
    commandPath: selected?.path ?? [],
    description: selected?.command.brief ?? 'Review export data locally',
    commands: (selected ? [selected] : entries).map((entry) => {
      const positional = entry.command.parameters.positional;
      const positionals =
        positional?.kind === 'array'
          ? [
              {
                name: positional.parameter.placeholder ?? 'path',
                description: positional.parameter.brief,
                type: 'string',
                variadic: true,
                minimum: positional.minimum ?? 0,
              },
            ]
          : (positional?.parameters ?? []).map((parameter, index) => ({
              name: parameter.placeholder ?? `arg${index + 1}`,
              description: parameter.brief,
              type: 'string',
              required: !parameter.optional,
            }));
      return {
        path: entry.path,
        description: entry.command.brief,
        positionals,
        options: Object.entries(entry.command.parameters.flags ?? {}).map(
          ([name, flag]) => ({
            name: name.replace(
              /[A-Z]/g,
              (letter) => `-${letter.toLowerCase()}`,
            ),
            description: flag.brief,
            type: flag.kind === 'boolean' ? 'boolean' : 'string',
            default: 'default' in flag ? flag.default : null,
            required: !flag.optional && !('default' in flag),
            ...('values' in flag ? { values: flag.values } : {}),
          }),
        ),
        outputSchemaIds: entry.outputSchemaIds.filter((id) =>
          schemaIds.has(id),
        ),
        writes: entry.writes,
        dryRun: entry.dryRun,
        available: entry.available,
      };
    }),
    options: [
      { name: 'help', alias: 'h', type: 'boolean', default: false },
      { name: 'json', type: 'boolean', default: false },
    ],
    exitCodes: EXIT_MEANINGS,
    outputSchemaIds: [CLI_SCHEMA_IDS.result, CLI_SCHEMA_IDS.help].filter((id) =>
      schemaIds.has(id),
    ),
    errorSchemaId: schemaIds.has(CLI_SCHEMA_IDS.error)
      ? CLI_SCHEMA_IDS.error
      : null,
  });
}
