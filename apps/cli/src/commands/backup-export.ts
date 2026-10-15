import { buildCommand } from '@stricli/core';
import { join, resolve } from 'node:path';
import { dryRunFlag, jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';
import { instagramContextFileSummary } from '../workspace/context-files.ts';
import { CliError } from '../cli/errors.ts';

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
  let contextFiles: { files: number; bytes: number };
  try {
    contextFiles = await instagramContextFileSummary(flags.workspace);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('BACKUP_FAILED');
  }
  const result = await workspaceService(context).exportBackup({
    ...workspaceCall(flags.workspace, context, flags.dryRun),
    out: flags.out,
  });
  const filesNote = contextFiles.files
    ? ` ${contextFiles.files} context files (${contextFiles.bytes} bytes) stay in ${join(resolve(flags.workspace), 'context', 'instagram')}. Copy that folder separately to keep them.`
    : '';
  return {
    ...result,
    data: { ...result.data, contextFiles },
    envelope: true,
    human: `${flags.dryRun ? 'Would export' : 'Exported'} a portable JSON backup with ${result.data.counts.items} entries.${filesNote}`,
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
