import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

export async function summaryHandler(
  workspace: string,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).summarizeWorkspace(
    workspaceCall(workspace, context),
  );
  return {
    ...result,
    envelope: true,
    human: `${result.data.counts.items} stored entries, ${result.data.decisions.undecided} visible undecided entries.`,
  };
}
export const summaryCommand = buildCommand({
  parameters: { flags: { json: jsonFlag, workspace: workspaceFlag } },
  docs: { brief: 'Show workspace counts without item text' },
  async func(
    this: CommandRunContext,
    flags: { json: boolean; workspace: string },
  ) {
    this.reply(await summaryHandler(flags.workspace, this));
  },
});
