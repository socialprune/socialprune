import { buildCommand } from '@stricli/core';
import { dryRunFlag, jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

export async function importHandler(
  paths: readonly string[],
  flags: { workspace: string; dryRun: boolean },
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).importWorkspace({
    ...workspaceCall(flags.workspace, context, flags.dryRun),
    paths,
  });
  return {
    ...result,
    envelope: true,
    status: result.partial ? 'partial' : 'ok',
    exitCode: result.partial ? 4 : 0,
    warnings: result.partial
      ? ['Some export data could not be imported (PARTIAL_IMPORT).']
      : [],
    human: `${flags.dryRun ? 'Would import' : 'Imported'} ${result.data.items} entries, ${result.data.added} new, ${result.data.conflicts} conflicts.`,
  };
}

export const importCommand = buildCommand({
  parameters: {
    flags: { json: jsonFlag, workspace: workspaceFlag, dryRun: dryRunFlag },
    positional: {
      kind: 'array',
      minimum: 1,
      parameter: {
        parse: String,
        placeholder: 'path',
        brief: 'Explicit ZIP file or export directory',
      },
    },
  },
  docs: {
    brief: 'Import exports into a local workspace',
    fullDescription:
      'Use a local disk, not a network share. Pause folder syncing while a command or review session runs.',
  },
  async func(
    this: CommandRunContext,
    flags: { json: boolean; workspace: string; dryRun: boolean },
    ...paths: string[]
  ) {
    this.reply(await importHandler(paths, flags, this));
  },
});
