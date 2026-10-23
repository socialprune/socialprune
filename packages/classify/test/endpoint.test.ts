import { expect, test } from 'vitest';
import { EndpointSource } from '../src/endpoint.ts';
import { nodeTransport } from '../src/node.ts';
import { parseSource } from '../src/config.ts';
import { generatedEntries, measureBatches } from '../src/measurement.ts';
import { runBatches, sourceVersion } from '../src/runner.ts';
import type { SourceLabelFile } from '../src/runner.ts';
import { PRESETS } from '@socialprune/core/criteria';
import { fakeEndpoint } from './fake-endpoint.ts';

const signal = () => new AbortController().signal;
const criteria = PRESETS.filter((c) => c.id === 'political');
test('a successful response echoing the explicit key is rejected before labels can be submitted', async () => {
  const key = 'generated-key-canary';
  const fake = await fakeEndpoint(() => ({
    body: {
      model: 'generated-model',
      choices: [{ message: { content: key } }],
    },
  }));
  const transport = nodeTransport(fake.origin);
  try {
    await expect(
      new EndpointSource(fake.config(), transport.transport, key).check(
        {
          criteria,
          entries: [
            { id: 'e1', platform: 'x', kind: 'post', text: 'Generated.' },
          ],
        },
        signal(),
      ),
    ).rejects.toThrow('ENDPOINT_RESPONSE_INVALID');
  } finally {
    transport.close();
    await fake.close();
  }
});
test('foundation: real local endpoint, count-only runner, mapped source-label submission and owned close', async () => {
  const fake = await fakeEndpoint();
  const transport = nodeTransport(fake.origin);
  const files: SourceLabelFile[] = [];
  try {
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: generatedEntries(51),
      criteria,
      entriesPerRequest: 25,
      signal: signal(),
      submit: (file) => {
        files.push(file);
        return Promise.resolve();
      },
    });
    expect(result.stored).toBe(51);
    expect(result.requests).toBe(3);
    expect(files).toHaveLength(3);
    expect(files.flatMap((file) => file.labels)).toHaveLength(51);
    expect(files[0]?.source.version).toBe(sourceVersion('generated-model'));
    const messages = fake.requests.map(
      (r) => r.body?.messages as { content: string }[],
    );
    expect(new Set(messages.map((m) => m[0]!.content)).size).toBe(1);
    expect(
      new Set(fake.requests.map((r) => JSON.stringify(r.body?.response_format)))
        .size,
    ).toBe(1);
    expect(messages[0]![1]!.content).not.toContain('itemId');
    expect(fake.requests.every((r) => r.authorization === undefined)).toBe(
      true,
    );
  } finally {
    transport.close();
    await fake.close();
  }
});
test('all three 1000-entry measurements use the same generated inputs and report actual token totals', async () => {
  const fake = await fakeEndpoint();
  const transport = nodeTransport(fake.origin);
  try {
    const result = await measureBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      signal: signal(),
    });
    expect(result.results.map((r) => r.requests)).toEqual([100, 40, 20]);
    expect(result.measuredDefault).toBe(50);
    expect(result.results.map((r) => r.tokens.promptTokens)).toEqual([
      11000, 5000, 3000,
    ]);
    expect(result.results.every((r) => r.prefixTokens === null)).toBe(true);
  } finally {
    transport.close();
    await fake.close();
  }
}, 60_000);
test.each([
  'http://localhost/v1',
  'http://example.com/v1',
  'https://user:pass@example.com/v1',
  'https://example.com/v1?q=x',
])('refuses unpermitted destination %s', (baseUrl) => {
  expect(() =>
    parseSource({
      schemaVersion: 1,
      name: 'generated',
      baseUrl,
      model: 'generated',
      entriesPerRequest: 25,
    }),
  ).toThrow('SOURCE_FILE_INVALID');
});
test.each([
  [401, 'unused', 'ENDPOINT_UNAUTHORIZED'],
  [403, 'unused', 'ENDPOINT_UNAUTHORIZED'],
  [404, 'unused', 'MODEL_NOT_FOUND'],
  [400, 'response_format refused', 'STRUCTURED_OUTPUT_REFUSED'],
  [413, 'request size too large', 'REQUEST_SIZE'],
  [429, 'unused', 'RETRYABLE_STATUS'],
  [503, 'unused', 'RETRYABLE_STATUS'],
])('real status %i maps to a closed code', async (status, body, code) => {
  const fake = await fakeEndpoint(() => ({ status: Number(status), body }));
  const transport = nodeTransport(fake.origin);
  try {
    await expect(
      new EndpointSource(fake.config(), transport.transport).check(
        {
          criteria,
          entries: [
            { id: 'e1', platform: 'x', kind: 'post', text: 'Generated.' },
          ],
        },
        signal(),
      ),
    ).rejects.toThrow(String(code));
  } finally {
    transport.close();
    await fake.close();
  }
});
test('Retry-After over 300 stops immediately, absent usage remains null and truncated JSON retains complete IDs', async () => {
  const limited = await fakeEndpoint(() => ({
    status: 429,
    headers: { 'Retry-After': '301' },
    body: 'not logged',
  }));
  const limitedTransport = nodeTransport(limited.origin);
  try {
    await expect(
      new EndpointSource(limited.config(), limitedTransport.transport).check(
        {
          criteria,
          entries: [
            { id: 'e1', platform: 'x', kind: 'post', text: 'Generated.' },
          ],
        },
        signal(),
      ),
    ).rejects.toThrow('ENDPOINT_RATE_LIMITED');
  } finally {
    limitedTransport.close();
    await limited.close();
  }
  const fake = await fakeEndpoint(() => ({
    body: {
      model: 'generated-model',
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: '{"results":[{"id":"e1","labels":[]},{"id":"e2"',
          },
        },
      ],
    },
  }));
  const transport = nodeTransport(fake.origin);
  try {
    const result = await new EndpointSource(
      fake.config(),
      transport.transport,
    ).check(
      {
        criteria,
        entries: [
          { id: 'e1', platform: 'x', kind: 'post', text: 'Generated.' },
          { id: 'e2', platform: 'x', kind: 'post', text: 'Generated second.' },
        ],
      },
      signal(),
    );
    expect(result.entries).toEqual([{ id: 'e1', labels: [] }]);
    expect(result.usage.promptTokens).toBeNull();
  } finally {
    transport.close();
    await fake.close();
  }
});
