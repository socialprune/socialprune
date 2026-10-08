import { buildCommand } from '@stricli/core';
import { dryRunFlag, jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

interface Flags {
  json: boolean;
  workspace: string;
  out: string;
  dryRun: boolean;
}
export async function backupExportHandler(
  flags: Flags,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).exportBackup({
    ...workspaceCall(flags.workspace, context, flags.dryRun),
    out: flags.out,
  });
  return {
    ...result,
    envelope: true,
    human: `${flags.dryRun ? 'Would export' : 'Exported'} a portable JSON backup with ${result.data.counts.items} entries.`,
  };
}
export const backupExportCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      dryRun: dryRunFlag,
      out: { kind: 'parsed', parse: String, brief: 'Destination JSON file' },
    },
  },
  docs: { brief: 'Export a portable JSON backup' },
  async func(this: CommandRunContext, flags: Flags) {
    this.reply(await backupExportHandler(flags, this));
  },
});
