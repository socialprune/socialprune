import { CRITERIA_SELECTED_MAX } from '@socialprune/core/criteria';
import type { SourceConfig } from './config.ts';
import { parseSource } from './config.ts';
import { object, completeResults } from './normalize.ts';
import { answerSchema, prefix } from './prompt.ts';
import { ScanError, emptyUsage, stopped } from './source.ts';
import type { CheckRequest, CheckAnswer, SuggestionSource } from './source.ts';

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string | null;
  timeoutSeconds: number;
}
export interface TransportReply {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}
export type Transport = (
  request: TransportRequest,
  signal: AbortSignal,
) => Promise<TransportReply>;
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function answerResults(raw: string, truncated: boolean) {
  const cleaned = raw.replace(/^\s*<think>\s*<\/think>\s*/, '');
  try {
    const value = object(JSON.parse(cleaned));
    return Array.isArray(value?.results)
      ? { entries: value.results as unknown[], format: 'json' as const }
      : { entries: [], format: 'invalid-envelope' as const };
  } catch {
    return {
      entries: truncated ? completeResults(cleaned) : [],
      format: truncated
        ? ('truncated-json' as const)
        : ('invalid-json' as const),
    };
  }
}
export function rejectRemoteModel(input: unknown) {
  const visit = (value: unknown): boolean => {
    const record = object(value);
    return (
      !!record &&
      Object.entries(record).some(
        ([key, child]) =>
          (/remote[_-]?(host|model)|cloud[_-]?(host|model)/i.test(key) &&
            !!child) ||
          visit(child),
      )
    );
  };
  const value = object(input);
  const from =
    typeof value?.modelfile === 'string'
      ? value.modelfile.split(/\r?\n/).find((line) => /^FROM\s/i.test(line))
      : undefined;
  if (
    visit(input) ||
    !from ||
    /https?:\/\//i.test(from) ||
    object(value?.details)?.format !== 'gguf' ||
    !object(value?.model_info)
  )
    throw new ScanError('REMOTE_MODEL');
}
export class EndpointSource implements SuggestionSource {
  readonly kind = 'model' as const;
  readonly name: string;
  readonly destination: string;
  readonly config: SourceConfig;
  private readonly transport: Transport;
  private readonly key: string | null;
  private readonly session: string;
  private localChecked = false;
  constructor(
    config: SourceConfig,
    transport: Transport,
    key: string | null = null,
  ) {
    this.config = parseSource(config);
    this.name = config.name;
    this.destination = new URL(config.baseUrl).origin;
    this.transport = transport;
    this.key = key;
    this.session = crypto.randomUUID();
    if (key !== null && (!key || /\s|[{}[\]:=]/.test(key)))
      throw new ScanError('KEY_FILE_INVALID');
  }
  async exchange(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    stopped(signal);
    const url = new URL(path);
    if (url.origin !== this.destination)
      throw new ScanError('REDIRECT_REFUSED');
    const reply = await this.transport(
      {
        url: url.href,
        method: body === null ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.key === null ? {} : { Authorization: `Bearer ${this.key}` }),
        },
        body: body === null ? null : JSON.stringify(body),
        timeoutSeconds: this.config.requestTimeoutSeconds,
      },
      signal,
    );
    stopped(signal);
    if (reply.status >= 300 && reply.status < 400)
      throw new ScanError('REDIRECT_REFUSED');
    if (reply.status === 401 || reply.status === 403)
      throw new ScanError('ENDPOINT_UNAUTHORIZED');
    if (reply.status === 404) throw new ScanError('MODEL_NOT_FOUND');
    if (reply.status === 400 && /response_format/i.test(reply.body))
      throw new ScanError('STRUCTURED_OUTPUT_REFUSED');
    if (
      (reply.status === 400 || reply.status === 413) &&
      /context.{0,30}(length|limit|size)|request.{0,30}(large|size)|too (large|long)|maximum.{0,20}tokens/i.test(
        reply.body,
      )
    )
      throw new ScanError('REQUEST_SIZE');
    if (reply.status === 408 || reply.status === 429 || reply.status >= 500) {
      const retry = reply.headers['retry-after'];
      const seconds =
        retry === undefined
          ? null
          : /^\d+(?:\.\d+)?$/.test(retry)
            ? Math.ceil(Number(retry))
            : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000));
      throw new ScanError(
        seconds !== null && seconds > 300
          ? 'ENDPOINT_RATE_LIMITED'
          : 'RETRYABLE_STATUS',
        Number.isFinite(seconds) ? seconds : null,
      );
    }
    if (reply.status !== 200) throw new ScanError('ENDPOINT_RESPONSE_INVALID');
    if (this.key !== null && reply.body.includes(this.key))
      throw new ScanError('ENDPOINT_RESPONSE_INVALID');
    try {
      return JSON.parse(reply.body) as unknown;
    } catch {
      return null;
    }
  }
  async check(
    request: CheckRequest,
    signal: AbortSignal,
  ): Promise<CheckAnswer> {
    if (
      !request.criteria.length ||
      request.criteria.length > CRITERIA_SELECTED_MAX ||
      new Set(request.criteria.map((c) => c.id)).size !==
        request.criteria.length ||
      request.criteria.some((c) => ['harmless', 'unclear'].includes(c.id)) ||
      request.entries.length < 1 ||
      request.entries.length > 50 ||
      request.entries.some((entry, index) => entry.id !== `e${index + 1}`)
    )
      throw new ScanError('SOURCE_FILE_INVALID');
    if (this.config.profile === 'ollama' && !this.localChecked) {
      if (/:cloud$/.test(this.config.model))
        throw new ScanError('REMOTE_MODEL');
      rejectRemoteModel(
        await this.exchange(
          this.destination + '/api/show',
          { model: this.config.model },
          signal,
        ),
      );
      this.localChecked = true;
    }
    const system = {
      role: 'system',
      content: prefix(request),
      ...(this.config.cacheControl
        ? { cache_control: { type: 'ephemeral' } }
        : {}),
    };
    const responseFormat =
      this.config.structuredOutput === 'none'
        ? {}
        : {
            response_format:
              this.config.structuredOutput === 'json_object'
                ? { type: 'json_object' }
                : this.config.profile === 'llama-server'
                  ? { type: 'json_schema', schema: answerSchema(request) }
                  : {
                      type: 'json_schema',
                      json_schema: {
                        name: 'socialprune_labels',
                        strict: true,
                        schema: answerSchema(request),
                      },
                    },
          };
    const body = {
      model: this.config.model,
      stream: false,
      messages: [
        system,
        {
          role: 'user',
          content:
            JSON.stringify(request.entries) +
            (request.failures
              ? '\nValidation failures:\n' + JSON.stringify(request.failures)
              : ''),
        },
      ],
      ...responseFormat,
      ...(this.config.profile === 'openrouter'
        ? {
            session_id: this.session,
            provider: {
              allow_fallbacks: false,
              require_parameters: true,
              data_collection: 'deny',
              ...(this.config.allowPaid
                ? {}
                : { max_price: { prompt: 0, completion: 0, request: 0 } }),
            },
          }
        : {}),
    };
    const data = object(
      await this.exchange(
        this.config.baseUrl + '/chat/completions',
        body,
        signal,
      ),
    );
    const choice = object(
      Array.isArray(data?.choices) ? data.choices[0] : null,
    );
    const content = object(choice?.message)?.content;
    const usage = object(data?.usage);
    return {
      answeredBy: typeof data?.model === 'string' ? data.model : null,
      truncated: choice?.finish_reason === 'length',
      ...(typeof content === 'string'
        ? answerResults(content, choice?.finish_reason === 'length')
        : { entries: [], format: 'invalid-envelope' as const }),
      ...(typeof content === 'string' ? { rawContent: content } : {}),
      usage: usage
        ? {
            promptTokens: count(usage.prompt_tokens),
            cachedPromptTokens: count(
              object(usage.prompt_tokens_details)?.cached_tokens,
            ),
            completionTokens: count(usage.completion_tokens),
          }
        : emptyUsage(),
    };
  }
}
