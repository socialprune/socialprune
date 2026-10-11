import { buildCommand } from '@stricli/core';
import { dryRunFlag, jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

export async function labelsSubmitHandler(
  file: string,
  workspace: string,
  dryRun: boolean,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).submitLabelFile({
    ...workspaceCall(workspace, context, dryRun),
    file,
  });
  return {
    ...result,
    human: result.data.duplicate
      ? `Submission already recorded. ${result.data.accepted} suggestions; nothing written.`
      : `${dryRun ? 'Would record' : 'Recorded'} ${result.data.accepted} agent suggestions. No decisions made.`,
    warnings: [
      ...(result.data.droppedEvidence
        ? [
            `Dropped evidence from ${result.data.droppedEvidence} labels because it was not a verbatim substring of the entry text.`,
          ]
        : []),
      ...result.warnings,
    ],
  };
}

export const labelsSubmitCommand = buildCommand({
  parameters: {
    flags: { json: jsonFlag, workspace: workspaceFlag, dryRun: dryRunFlag },
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'JSON file of agent suggestions',
          placeholder: 'file',
        },
      ],
    },
  },
  docs: { brief: 'Validate and record agent suggestions, never decisions' },
  async func(
    this: CommandRunContext,
    flags: { json: boolean; workspace: string; dryRun: boolean },
    file: string,
  ) {
    this.reply(
      await labelsSubmitHandler(file, flags.workspace, flags.dryRun, this),
    );
  },
});
