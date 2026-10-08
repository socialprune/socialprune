import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag, dryRunFlag } from '../cli/context.ts';
import type { CliContext, CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { writeReply } from '../cli/output.ts';
import { workspaceService, workspaceCall } from './workspace-context.ts';
import { startReviewServer } from '../review/server.ts';
import { reviewAssetDirectory } from '../review/static.ts';

export async function reviewHandler(
  flags: { workspace: string; dryRun: boolean; noOpen: boolean; json: boolean },
  context: CliContext,
): Promise<void> {
  const service = workspaceService(context); // Node floor precedes any workspace access.
  if (flags.dryRun) {
    const result = await service.summarizeWorkspace(
      workspaceCall(flags.workspace, context),
    );
    writeReply(context, 'review', flags.json, {
      workspace: result.workspace,
      data: {
        dryRun: true,
        counts: result.data.counts,
        browser: !flags.noOpen,
        listener: '127.0.0.1',
        port: 0,
      },
      human: `Would review ${result.data.counts.items} stored entries. Nothing was started or opened.`,
    });
    return;
  }
  if (flags.noOpen && !context.stderrIsTerminal)
    throw new CliError('NO_TOKEN_CHANNEL');
  const server = await startReviewServer({
    workspace: flags.workspace,
    assetDirectory: context.reviewAssetDirectory ?? reviewAssetDirectory(),
    signal: context.signal,
  });
  try {
    let delivery: 'browser' | 'terminal' = flags.noOpen
      ? 'terminal'
      : 'browser';
    if (!flags.noOpen) {
      try {
        if (!context.openBrowser) throw new CliError('BROWSER_OPEN_FAILED');
        await context.openBrowser(server.launchUrl);
      } catch {
        if (!context.stderrIsTerminal)
          throw new CliError('BROWSER_OPEN_FAILED');
        delivery = 'terminal';
      }
    }
    if (delivery === 'terminal')
      context.io.stderr.write(server.launchUrl + '\n');
    else
      context.io.stderr.write(
        `Review is running at ${server.url}. Your browser opens it now. Press Ctrl+C to stop.\n`,
      );
    if (flags.json)
      writeReply(context, 'review', true, {
        data: {
          lifecycle: 'running',
          url: server.url,
          tokenDelivery: delivery,
          pid: context.pid ?? 0,
        },
        human: '',
      });
    await server.closed;
  } finally {
    await server.stop();
  }
}

export const reviewCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      workspace: workspaceFlag,
      dryRun: dryRunFlag,
      noOpen: {
        kind: 'boolean',
        brief: 'Print the one-use URL only to a terminal on stderr',
        default: false,
      },
    },
  },
  docs: {
    brief:
      'Open a local review for a person; decisions come only from the page',
  },
  async func(
    this: CommandRunContext,
    flags: {
      json: boolean;
      workspace: string;
      dryRun: boolean;
      noOpen: boolean;
    },
  ) {
    await reviewHandler(flags, this);
    this.reply({ data: null, human: '', silent: true });
  },
});
