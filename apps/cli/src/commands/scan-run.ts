import { buildCommand } from '@stricli/core';
import { jsonFlag, workspaceFlag, dryRunFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError, CLI_ERRORS } from '../cli/errors.ts';
import { workspaceCall, workspaceService } from './workspace-context.ts';
import { integerFlag } from './scan-source.ts';
import { plainLines } from '../cli/output.ts';
import type { RunProgress } from '@socialprune/classify';

function humanProgress(
  text: string,
  planned: number | undefined,
  progressState: { sending: number },
) {
  if (!text.startsWith('{')) return text;
  const value = JSON.parse(text) as Partial<RunProgress> & {
    stopDetail?: string;
    waitSeconds?: number | null;
    event?: string;
    planned?: number;
  };
  if (value.stopDetail)
    return `Stopped: ${value.stopDetail}${value.waitSeconds == null ? '' : `; requested wait ${value.waitSeconds} seconds`}.`;
  if (value.event === 'planned') return '';
  if ((value.requests ?? 0) > progressState.sending) {
    progressState.sending = value.requests ?? 0;
    return `Sending request ${value.requests} of ${planned ?? '?'}; batch ${Math.min(value.batchSize ?? 0, value.remaining ?? 0)}.`;
  }
  const tokens = value.tokens;
  const tokenLine =
    tokens && Object.values(tokens).some((value) => value !== null)
      ? ` Tokens: input ${tokens.promptTokens ?? 'not reported'}; cached ${tokens.cachedPromptTokens ?? 'not reported'}; output ${tokens.completionTokens ?? 'not reported'}.`
      : '';
  return `Stored ${value.stored ?? 0}; remaining ${value.remaining ?? 0}; requests ${value.requests ?? 0}; retries ${value.retries ?? 0}; second pass ${value.secondPassRequests ?? 0}; splits ${value.split ?? 0}; batch size ${value.batchSize ?? 0}.${tokenLine}`;
}
function humanReport(
  data: Awaited<
    ReturnType<import('../workspace/services.ts').WorkspaceServices['runScan']>
  >['data'],
) {
  const pairs = (values: Record<string, number>) =>
    Object.entries(values)
      .map(([key, count]) => `${key} ${count}`)
      .join(', ') || 'none';
  if (!data.coverageCounted)
    return [
      'Suggestion run stopped before counting or selecting workspace entries.',
      data.source.answeringModel
        ? `The endpoint answered as ${data.source.answeringModel}; you confirmed ${data.source.confirmedModel}. Nothing was stored.`
        : `No answering model was observed; you confirmed ${data.source.confirmedModel}. Nothing was stored.`,
      'No workspace entry was sent. Only the invented model check was attempted.',
      `Stop detail: ${data.stopDetail}`,
    ].join('\n');
  const lines = [
    data.dryRun
      ? 'Dry-run plan. No request was sent or suggestion written.'
      : data.stopDetail
        ? 'Suggestion run stopped.'
        : 'Suggestion run finished.',
    `Source: ${data.source.name}; endpoint ${data.source.origin}`,
    `Requested model: ${data.source.model}; confirmed model ${data.source.confirmedModel ?? 'not supplied'}; answering model ${data.source.answeringModel ?? 'not observed'}`,
    `Plan: ${data.plan}`,
    `Coverage model: ${data.coverageModel}${data.coverageProvisional ? ' (provisional; endpoint not contacted)' : ''}`,
    `Entries planned: ${data.entries!.planned}; already checked by this source: ${data.entries!.skipped.currentSource}; unique texts: ${data.entries!.uniqueTexts}`,
    `Already decided: ${data.entries!.alreadyDecided}; checked by other sources: ${data.entries!.checkedElsewhere}`,
    `Pending checks by criterion: ${pairs(data.criteria)}`,
    `Requests planned: ${data.requests.planned}; batch size: ${data.batchSize}`,
  ];
  if (
    !data.dryRun &&
    data.entries &&
    'checked' in data.entries &&
    'sent' in data.requests
  ) {
    lines.push(
      ...(data.stopDetail === 'MODEL_CHANGED'
        ? [
            `The endpoint answered as ${data.source.answeringModel ?? 'no model'}; you confirmed ${data.source.confirmedModel}. This response was not stored; earlier stored suggestions remain.`,
          ]
        : []),
      `Suggestions stored: ${data.entries.checked}; entries remaining: ${data.entries.remaining}`,
      `Requests sent: ${data.requests.sent}; retries: ${data.requests.retried}; second pass: ${data.requests.secondPass}; splits: ${data.requests.split}; failed: ${data.requests.failed}`,
      `Hits by criterion: ${pairs(data.hits ?? {})}`,
      `Labels by risk: ${
        Object.entries(data.labelsPerRisk ?? {})
          .map(([risk, count]) => `risk ${risk}: ${count}`)
          .join('; ') || 'none'
      }`,
      `Unclear by kind and cause: ${pairs(data.unclear ?? {})}`,
      `Tokens: input ${data.tokens?.promptTokens ?? 'not reported'}; cached ${data.tokens?.cachedPromptTokens ?? 'not reported'}; output ${data.tokens?.completionTokens ?? 'not reported'}`,
      `Duration: ${data.durationMs} ms`,
      `Stop detail: ${data.stopDetail ?? 'none'}`,
    );
  }
  return lines.join('\n');
}

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
      let planned: number | undefined;
      const progressState = { sending: 0 };
      const result = await workspaceService(this).runScan({
        ...workspaceCall(flags.workspace, this, flags.dryRun),
        signal: controller.signal,
        source: flags.source,
        account: flags.account,
        limit: flags.limit,
        plan: flags.plan,
        confirmEndpoint: flags.confirmEndpoint,
        confirmModel: flags.confirmModel,
        progress: (text) => {
          if (text.startsWith('{')) {
            const value = JSON.parse(text) as {
              event?: string;
              planned?: number;
            };
            if (value.event === 'planned') planned = value.planned;
          }
          const rendered = flags.json
            ? text
            : humanProgress(text, planned, progressState);
          if (rendered) this.io.stderr.write(plainLines(rendered) + '\n');
        },
      });
      const reportWarnings =
        ('warnings' in result ? result.warnings : [])?.filter(
          (warning) =>
            !Object.keys(CLI_ERRORS).some((code) =>
              warning.startsWith(code + ': '),
            ),
        ) ?? [];
      this.reply({
        ...result,
        ...(flags.json ? {} : { warnings: reportWarnings }),
        human: humanReport(result.data),
      });
    } finally {
      this.signal.removeEventListener('abort', stop);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  },
});
