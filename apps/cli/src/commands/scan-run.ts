import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag, dryRunFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';
import { integerFlag } from './scan-source.ts';
import { plainLines } from '../cli/output.ts';

export const scanRunCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      dryRun: dryRunFlag,
      source: {
        kind: 'parsed',
        parse: String,
        brief: 'Source file the person explicitly named',
      },
      account: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Account selected by the person',
      },
      limit: {
        kind: 'parsed',
        parse: integerFlag(1, Number.MAX_SAFE_INTEGER),
        optional: true,
        brief: 'Maximum distinct entries, not requests',
      },
      plan: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Plan hash from this source and workspace dry run',
      },
      confirmEndpoint: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Explicit agreement to send to this exact origin',
      },
      confirmModel: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Answering model name from scan check',
      },
    },
  },
  docs: {
    brief:
      'Suggest labels through the named endpoint; dry-run makes no request or write',
  },
  async func(
    this: CommandRunContext,
    flags: {
      json: boolean;
      workspace: string;
      dryRun: boolean;
      source: string;
      account?: string;
      limit?: number;
      plan?: string;
      confirmEndpoint?: string;
      confirmModel?: string;
    },
  ) {
    if (
      !flags.dryRun &&
      (!flags.plan || !flags.confirmEndpoint || !flags.confirmModel)
    )
      throw new CliError('ENDPOINT_NOT_CONFIRMED');
    const controller = new AbortController();
    const stop = () => controller.abort();
    this.signal.throwIfAborted();
    this.signal.addEventListener('abort', stop, { once: true });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const result = await workspaceService(this).runScan({
        ...workspaceCall(flags.workspace, this, flags.dryRun),
        signal: controller.signal,
        source: flags.source,
        account: flags.account,
        limit: flags.limit,
        plan: flags.plan,
        confirmEndpoint: flags.confirmEndpoint,
        confirmModel: flags.confirmModel,
        progress: (text) => this.io.stderr.write(plainLines(text) + '\n'),
      });
      this.reply({ ...result, human: JSON.stringify(result.data) });
    } finally {
      this.signal.removeEventListener('abort', stop);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  },
});
