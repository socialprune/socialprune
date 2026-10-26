import { expect, test } from 'vitest';
import { PRESETS } from '@socialprune/core/criteria';
import { EndpointSource } from '../src/endpoint.ts';
import { nodeTransport } from '../src/node.ts';
import { runBatches } from '../src/runner.ts';
import { fakeEndpoint } from './fake-endpoint.ts';
import { readFile } from 'node:fs/promises';
import {
  prefix,
  answerSchema,
  INSTRUCTIONS,
  RUBRIC_VERSION,
  ANSWER_FORMAT,
} from '../src/prompt.ts';
import { definitionHash } from '@socialprune/core/criteria';

const criteria = PRESETS.filter((criterion) => criterion.id === 'political');

test('every S2 synthetic reply/quote keeps its full text but never shares the referenced original', async () => {
  const rows = (
    await readFile(
      new URL(
        '../../../fixtures/synthetic/classify/items.jsonl',
        import.meta.url,
      ),
      'utf8',
    )
  )
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          id: string;
          platform: 'x' | 'instagram';
          kind: 'reply' | 'quote';
          text: string;
          reference: unknown;
        },
    );
  const entries = rows
    .filter((row) => row.kind === 'reply' || row.kind === 'quote')
    .slice(0, 50);
  const fake = await fakeEndpoint();
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: entries.map((row) => ({
        itemId: row.id,
        contentHash: definitionHash(row.text),
        platform: row.platform,
        kind: row.kind,
        text: row.text,
      })),
      criteria,
      entriesPerRequest: 25,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result.stored).toBe(50);
    expect(result.secondPassRequests).toBe(0);
    const sent = fake.requests.flatMap(
      (request) =>
        JSON.parse(
          (request.body!.messages as { content: string }[])[1]!.content,
        ) as { text: string }[],
    );
    expect(sent.map((entry) => entry.text)).toEqual(
      entries.map((entry) => entry.text),
    );
    expect(
      sent.every(
        (entry) =>
          Object.keys(entry).sort().join(',') === 'id,kind,platform,text',
      ),
    ).toBe(true);
    expect(INSTRUCTIONS).toContain(
      'No original post or conversation context is supplied',
    );
    expect(INSTRUCTIONS).toContain('Never lower risk merely to omit a quote');
    expect(prefix({ criteria: [...criteria].reverse() })).toBe(
      prefix({ criteria }),
    );
    expect(answerSchema({ criteria: [...criteria].reverse() })).toEqual(
      answerSchema({ criteria }),
    );
    expect(RUBRIC_VERSION).toBe(
      definitionHash(INSTRUCTIONS + '\n' + ANSWER_FORMAT)
        .replace(/^sha256:/, '')
        .slice(0, 12),
    );
  } finally {
    transport.close();
    await fake.close();
  }
});

test('truncation and malformed responses report closed causes and pass-local token totals', async () => {
  const fake = await fakeEndpoint((request, index) => ({
    body: {
      model: 'generated-model',
      choices: [
        {
          finish_reason: index === 0 ? 'length' : 'stop',
          message: {
            content:
              index === 0
                ? '{"results":[{"id":"e1","labels":[]},{"id":"e2"'
                : index === 1
                  ? 'generated malformed output canary'
                  : '{"results":[{"id":"e1","labels":[]}]}',
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: index === 0 ? 4096 : 20 },
    },
  }));
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: Array.from({ length: 3 }, (_, index) => ({
        itemId: `x:generated-${index}`,
        contentHash: 'generated',
        platform: 'x',
        kind: 'reply',
        text: `Generated reply ${index}.`,
      })),
      criteria,
      entriesPerRequest: 3,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result.diagnostics.firstPass).toMatchObject({
      truncatedAnswers: 1,
      failures: { MISSING_ID: 2 },
      maxCompletionTokens: 4096,
      requestedCompletionLimit: null,
      tokens: { completionTokens: 4096 },
      failuresInTruncatedAnswers: { MISSING_ID: 2 },
      completionTokensReported: 1,
      completionTokenBuckets: { from4096To8191: 1 },
    });
    expect(result.diagnostics.secondPass).toMatchObject({
      invalidJsonAnswers: 1,
      fallbackEntries: 2,
      failures: { MISSING_ID: 2 },
      tokens: { completionTokens: 20 },
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(
      'malformed output canary',
    );
  } finally {
    transport.close();
    await fake.close();
  }
});

test('a truncated response after the supported empty thought wrapper retains completed entries', async () => {
  const fake = await fakeEndpoint((request, index) => ({
    body: {
      model: 'generated-model',
      choices: [
        {
          finish_reason: index === 0 ? 'length' : 'stop',
          message: {
            content:
              index === 0
                ? '<think> </think>\n{"results":[{"id":"e1","labels":[]},{"id":"e2"'
                : '{"results":[{"id":"e1","labels":[]}]}',
          },
        },
      ],
    },
  }));
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: [0, 1].map((index) => ({
        itemId: `x:generated-${index}`,
        contentHash: 'generated',
        platform: 'x',
        kind: 'reply',
        text: `Generated wrapped note ${index}.`,
      })),
      criteria,
      entriesPerRequest: 50,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result.secondPassEntries).toBe(1);
    expect(result.diagnostics.firstPass.failures.MISSING_ID).toBe(1);
    expect(
      fake.requests.map(
        (request) =>
          (
            JSON.parse(
              (
                request.body!.messages as { content: string }[]
              )[1]!.content.split('\nValidation failures:')[0]!,
            ) as unknown[]
          ).length,
      ),
    ).toEqual([2, 1]);
  } finally {
    transport.close();
    await fake.close();
  }
});

test('salvaging 26 complete wrapped results avoids one repeated prefix for a 50-entry batch', async () => {
  const fake = await fakeEndpoint((request, index) => {
    const entries = JSON.parse(
      (request.body!.messages as { content: string }[])[1]!.content.split(
        '\nValidation failures:',
      )[0]!,
    ) as { id: string }[];
    const complete = JSON.stringify({
      results: entries.slice(0, 26).map(({ id }) => ({ id, labels: [] })),
    });
    return {
      body: {
        model: 'generated-model',
        choices: [
          {
            finish_reason: index === 0 ? 'length' : 'stop',
            message: {
              content:
                index === 0
                  ? '<think></think>\n' + complete.slice(0, -2) + ',{"id":"e27"'
                  : JSON.stringify({
                      results: entries.map(({ id }) => ({ id, labels: [] })),
                    }),
            },
          },
        ],
      },
    };
  });
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: Array.from({ length: 50 }, (_, index) => ({
        itemId: `x:generated-${index}`,
        contentHash: 'generated',
        platform: 'x',
        kind: 'reply',
        text: `Generated salvage note ${index}.`,
      })),
      criteria,
      entriesPerRequest: 50,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result).toMatchObject({
      stored: 50,
      requests: 2,
      secondPassEntries: 24,
      secondPassRequests: 1,
    });
    expect(result.diagnostics.firstPass.failures.MISSING_ID).toBe(24);
  } finally {
    transport.close();
    await fake.close();
  }
});

test('REQUEST_SIZE splitting is not miscounted as normalization failure and remains suggestion-only', async () => {
  const fake = await fakeEndpoint((request) => {
    const entries = JSON.parse(
      (request.body!.messages as { content: string }[])[1]!.content,
    ) as unknown[];
    return entries.length > 1
      ? { status: 413, body: 'Generated request size too large' }
      : {};
  });
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: [0, 1].map((index) => ({
        itemId: `x:generated-${index}`,
        contentHash: 'generated',
        platform: 'x',
        kind: 'reply',
        text: `Generated size note ${index}.`,
      })),
      criteria,
      entriesPerRequest: 50,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result).toMatchObject({
      stored: 2,
      split: 1,
      secondPassRequests: 0,
      diagnostics: {
        firstPass: {
          answers: 2,
          entryChecks: 2,
          failures: {
            MISSING_ID: 0,
            DUPLICATE_ID: 0,
            INVALID_LABEL: 0,
            MISSING_QUOTE: 0,
          },
        },
      },
    });
  } finally {
    transport.close();
    await fake.close();
  }
});
test('closed diagnostics separate first-pass causes, recovered entries and second-pass fallback without content', async () => {
  const fake = await fakeEndpoint((request, index) => {
    const entries = JSON.parse(
      (request.body!.messages as { content: string }[])[1]!.content.split(
        '\nValidation failures:',
      )[0]!,
    ) as { id: string; text: string }[];
    const results: unknown[] = entries.map((entry) => ({
      id: entry.id,
      labels: [],
    }));
    if (index === 0) {
      results[0] = {
        id: 'e1',
        labels: [
          {
            category: 'political',
            risk: 2,
            quote: null,
            reason: 'Generated reason.',
          },
        ],
      };
      results[1] = {
        id: 'e2',
        labels: [
          {
            category: 'political',
            risk: 2,
            quote: 'Generated',
            reason: 'Generated reason. Second sentence.',
          },
        ],
      };
      results.pop();
      results.push({ id: 'foreign-content-canary', labels: [] });
    }
    return {
      body: {
        model: 'generated-model',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ results }) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      },
    };
  });
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: Array.from({ length: 3 }, (_, index) => ({
        itemId: `x:generated-${index}`,
        contentHash: 'generated',
        platform: 'x',
        kind: 'reply',
        text: `Generated private-canary ${index}.`,
      })),
      criteria,
      entriesPerRequest: 3,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result.diagnostics.firstPass.failures).toEqual({
      MISSING_ID: 1,
      DUPLICATE_ID: 0,
      INVALID_LABEL: 1,
      MISSING_QUOTE: 1,
    });
    expect(result.diagnostics.firstPass.details).toMatchObject({
      QUOTE_MISSING: 1,
      REASON_FORMAT: 1,
    });
    expect(result.diagnostics.firstPass.unknownIds).toBe(1);
    expect(result.diagnostics.firstPass.byKind.reply.failures).toEqual(
      result.diagnostics.firstPass.failures,
    );
    expect(result.diagnostics.secondPass.recoveredEntries).toBe(3);
    expect(result.diagnostics.secondPass.fallbackEntries).toBe(0);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /private-canary|foreign-content-canary|Generated reason|e1|x:generated/,
    );
  } finally {
    transport.close();
    await fake.close();
  }
});

test('generated endpoint follows the response schema on reason format and category without a second pass', async () => {
  const fake = await fakeEndpoint((request) => {
    const schema = (
      request.body!.response_format as {
        json_schema: {
          schema: {
            properties: {
              results: {
                items: {
                  properties: {
                    labels: {
                      items: {
                        properties: {
                          reason: { maxLength?: number; pattern?: string };
                          category: { enum?: string[] };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      }
    ).json_schema.schema;
    const labelSchema =
      schema.properties.results.items.properties.labels.items.properties;
    const constrained =
      labelSchema.reason.maxLength === 300 &&
      !!labelSchema.reason.pattern &&
      labelSchema.category.enum?.includes('political');
    const messages = request.body!.messages as { content: string }[];
    const entries = JSON.parse(
      messages[1]!.content.split('\nValidation failures:')[0]!,
    ) as { id: string; text: string }[];
    return {
      body: {
        model: 'generated-model',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                results: entries.map((entry) => ({
                  id: entry.id,
                  labels: [
                    {
                      category: 'political',
                      risk: 2,
                      quote: entry.text.slice(0, 8),
                      reason: constrained
                        ? 'A generated political statement.'
                        : 'A generated political statement. A second sentence.',
                    },
                  ],
                })),
              }),
            },
          },
        ],
      },
    };
  });
  const transport = nodeTransport(fake.origin);
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: [
        {
          itemId: 'x:generated',
          contentHash: 'generated',
          platform: 'x',
          kind: 'reply',
          text: 'Generated party policy statement.',
        },
      ],
      criteria,
      entriesPerRequest: 50,
      signal: new AbortController().signal,
      submit: () => Promise.resolve(),
    });
    expect(result.requests).toBe(1);
    expect(result.secondPassRequests).toBe(0);
  } finally {
    transport.close();
    await fake.close();
  }
});
