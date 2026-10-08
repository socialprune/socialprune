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
  dryRun: boolean;
}
export async function backupRestoreHandler(
  file: string,
  flags: Flags,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).restoreWorkspace({
    ...workspaceCall(flags.workspace, context, flags.dryRun),
    file,
  });
  return {
    ...result,
    envelope: true,
    human: `${flags.dryRun ? 'Would restore' : 'Restored'} ${result.data.counts.items} entries from the JSON backup.${result.data.previousFile ? ` Previous database kept at ${result.data.previousFile}.` : ''}`,
  };
}
export const backupRestoreCommand = buildCommand({
  parameters: {
    flags: { json: jsonFlag, workspace: workspaceFlag, dryRun: dryRunFlag },
    positional: {
      kind: 'tuple',
      parameters: [
        { parse: String, placeholder: 'file', brief: 'Portable JSON backup' },
      ],
    },
  },
  docs: {
    brief: 'Validate and restore a JSON backup, keeping the previous database',
  },
  async func(this: CommandRunContext, flags: Flags, file: string) {
    this.reply(await backupRestoreHandler(file, flags, this));
  },
});
