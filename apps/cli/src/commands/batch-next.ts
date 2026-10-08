import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import type { BatchCall } from '../workspace/services.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

type BatchOptions = Omit<BatchCall, 'workspace' | 'dryRun' | 'signal' | 'now'>;

export async function batchNextHandler(
  workspace: string,
  options: BatchOptions,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).nextBatch({
    ...workspaceCall(workspace, context),
    ...options,
  });
  const count = result.data.shared.count;
  return {
    ...result,
    notices: [
      `Sharing ${count} entries with the agent that runs this command: for each, the entry ID, kind, date, a hash of the text and the full text. The agent sends them to the model provider it uses. SocialPrune cannot see or limit what happens to them there.`,
    ],
    human: [
      result.data.notice,
      ...result.data.items.map((item) =>
        [
          item.itemId,
          item.kind,
          item.createdAt,
          item.contentHash,
          item.content.text,
        ].join('\n'),
      ),
      `${count} entries shared. ${result.data.remaining} entries remain from this cursor.`,
      ...(result.data.nextCursor
        ? [`Next cursor: ${result.data.nextCursor}`]
        : []),
    ].join('\n'),
  };
}

export const batchNextCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      shareWithAgent: {
        kind: 'boolean',
        default: false,
        brief: 'Share entry text only after the person agrees',
      },
      account: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Select one account key',
      },
      size: {
        kind: 'parsed',
        default: '50',
        parse(value: string) {
          if (!/^\d+$/.test(value)) throw new CliError('INVALID_ARGUMENTS');
          const size = Number(value);
          if (!Number.isSafeInteger(size) || size < 1 || size > 200)
            throw new CliError('INVALID_ARGUMENTS');
          return size;
        },
        brief: 'Maximum entries, from 1 to 200',
      },
      cursor: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Resume the same account and source name',
      },
      sourceName: {
        kind: 'parsed',
        parse: String,
        default: 'agent',
        brief: 'Skip suggestions already written by this agent name',
      },
    },
  },
  docs: {
    brief: 'Read untrusted entry text for agent suggestions, without writing',
  },
  async func(
    this: CommandRunContext,
    flags: {
      json: boolean;
      workspace: string;
      shareWithAgent: boolean;
      account?: string;
      size: number;
      cursor?: string;
      sourceName: string;
    },
  ) {
    this.reply(
      await batchNextHandler(
        flags.workspace,
        {
          shareWithAgent: flags.shareWithAgent,
          account: flags.account,
          size: flags.size,
          cursor: flags.cursor,
          sourceName: flags.sourceName,
        },
        this,
      ),
    );
  },
});
