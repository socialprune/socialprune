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
  account: string;
  format: 'csv' | 'json';
  out: string;
  dryRun: boolean;
  timeZone?: string;
}
export async function clickListHandler(
  flags: Flags,
  context: CliContext,
): Promise<CommandReply> {
  const result = await workspaceService(context).exportClickList({
    ...workspaceCall(flags.workspace, context, flags.dryRun),
    account: flags.account,
    format: flags.format,
    out: flags.out,
    timeZone: flags.timeZone,
  });
  return {
    ...result,
    envelope: true,
    human: `${flags.dryRun ? 'Would export' : 'Exported'} ${result.data.count} click-list entries. Days in ${result.data.timeZone} (${result.data.timeZoneSource}).`,
  };
}
export const clickListCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      dryRun: dryRunFlag,
      account: {
        kind: 'parsed',
        parse: String,
        brief: 'Account key from summary',
      },
      format: {
        kind: 'enum',
        values: ['csv', 'json'],
        brief: 'File format',
        default: 'csv',
      },
      out: { kind: 'parsed', parse: String, brief: 'Destination file' },
      timeZone: {
        kind: 'parsed',
        parse: String,
        brief: 'IANA zone for this export only',
        optional: true,
      },
    },
  },
  docs: {
    brief: 'Export the human-reviewed click list without platform requests',
  },
  async func(this: CommandRunContext, flags: Flags) {
    this.reply(await clickListHandler(flags, this));
  },
});
