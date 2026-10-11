import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag, dryRunFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';

export const originalsFetchCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      dryRun: dryRunFlag,
      account: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Select one X account key',
      },
      limit: {
        kind: 'parsed',
        optional: true,
        brief: 'Maximum referenced originals to fetch',
        parse(value: string) {
          const limit = Number(value);
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit < 1)
            throw new CliError('INVALID_ARGUMENTS');
          return limit;
        },
      },
    },
  },
  docs: {
    brief:
      'Fetch referenced X posts and photos anonymously, only on this command; dry-run uses no network',
  },
  async func(
    this: CommandRunContext,
    flags: {
      json: boolean;
      workspace: string;
      dryRun: boolean;
      account?: string;
      limit?: number;
    },
  ) {
    const result = await workspaceService(this).fetchOriginals({
      ...workspaceCall(flags.workspace, this, flags.dryRun),
      account: flags.account,
      limit: flags.limit,
      progress: (text) => this.io.stderr.write(`${text}\n`),
    });
    const data = result.data;
    if (data.failed || data.photosFailed) {
      this.io.stderr.write(
        `${data.attempted} originals recorded; ${data.failed} fetches and ${data.photosFailed} photos failed; ${data.remaining} originals remain.\n`,
      );
      if (data.stoppedAfterFailures)
        this.io.stderr.write(
          'Stopped after five consecutive failures. No retries were made.\n',
        );
      throw new CliError('ORIGINALS_FAILED');
    }
    this.reply({
      ...result,
      human: flags.dryRun
        ? `${data.referenced} referenced originals; ${data.stored} already stored; ${data.planned} would be fetched. No files changed and no network requests made.`
        : `${data.attempted} originals recorded: ${data.fetched} fetched, ${data.notFound} not found, ${data.tombstone} withheld or private, ${data.failed} failed. ${data.photosStored} photos stored. ${data.remaining} remain.`,
      warnings: [
        ...(data.stoppedAfterFailures
          ? ['Stopped after five consecutive failures. No retries were made.']
          : []),
        ...(data.photosFailed
          ? [`${data.photosFailed} photos could not be stored.`]
          : []),
      ],
    });
  },
});
