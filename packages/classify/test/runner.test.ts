import { expect, test } from 'vitest';
import { PRESETS } from '@socialprune/core/criteria';
import { generatedEntries } from '../src/measurement.ts';
import { runBatches, sourceVersion } from '../src/runner.ts';
import type { SourceLabelFile, RunOptions } from '../src/runner.ts';
import { ScanError, emptyUsage } from '../src/source.ts';
import type {
  CheckRequest,
  CheckAnswer,
  SuggestionSource,
} from '../src/source.ts';

const criteria = PRESETS.filter(
  (c) => c.id === 'political' || c.id === 'toxic',
);
const valid = (request: CheckRequest): CheckAnswer => ({
  answeredBy: 'generated-model',
  truncated: false,
  usage: emptyUsage(),
  entries: request.entries.map((e) => ({ id: e.id, labels: [] })),
});
function fixture(
  check: (
    request: CheckRequest,
    index: number,
    signal: AbortSignal,
  ) => Promise<CheckAnswer> | CheckAnswer = valid,
) {
  const requests: CheckRequest[] = [];
  const files: SourceLabelFile[] = [];
  const waits: number[] = [];
  const source: SuggestionSource = {
    kind: 'model',
    name: 'generated',
    destination: 'http://127.0.0.1',
    check(request, signal) {
      requests.push(request);
      return Promise.resolve(check(request, requests.length - 1, signal));
    },
  };
  const options: RunOptions = {
    source,
    answeringModel: 'generated-model',
    confirmedOrigin: source.destination,
    entries: generatedEntries(51),
    criteria,
    entriesPerRequest: 25,
    signal: new AbortController().signal,
    submit: (file) => {
      files.push(file);
      return Promise.resolve();
    },
    wait: (seconds) => {
      waits.push(seconds);
      return Promise.resolve();
    },
  };
  return { options, requests, files, waits };
}
test('only invalid entries are retried once, at half size, then get the fixed unclear reason', async () => {
  const h = fixture((request) => ({
    ...valid(request),
    entries: request.entries.slice(1).map((e) => ({ id: e.id, labels: [] })),
  }));
  h.options.entries = generatedEntries(10);
  h.options.entriesPerRequest = 10;
  const result = await runBatches(h.options);
  expect(h.requests.map((r) => r.entries.length)).toEqual([10, 1]);
  expect(result.stored).toBe(10);
  expect(h.requests[1]?.failures).toEqual([{ id: 'e1', code: 'MISSING_ID' }]);
  expect(
    h.files.flatMap((f) => f.labels).filter((l) => l.category === 'unclear'),
  ).toHaveLength(1);
});
test('a quote failure costs only its entry and uses the quote-specific fallback', async () => {
  const h = fixture((request) => ({
    ...valid(request),
    entries: request.entries.map((e, i) => ({
      id: e.id,
      labels:
        i === 0
          ? [
              {
                category: 'political',
                risk: 2,
                quote: null,
                reason: 'Generated reason.',
              },
            ]
          : [],
    })),
  }));
  h.options.entries = generatedEntries(3);
  await runBatches(h.options);
  expect(h.requests.map((r) => r.entries.length)).toEqual([3, 1]);
  expect(
    h.files.flatMap((f) => f.labels).find((l) => l.category === 'unclear')
      ?.reason,
  ).toBe('The model gave no exact quote from the text for this suggestion');
});
test('size errors split and single-entry size refusal produces unclear without changing modes', async () => {
  const h = fixture((request) => {
    if (request.entries.length > 2) throw new ScanError('REQUEST_SIZE');
    return valid(request);
  });
  h.options.entries = generatedEntries(5);
  h.options.entriesPerRequest = 5;
  expect((await runBatches(h.options)).stored).toBe(5);
  expect(h.requests.map((r) => r.entries.length)).toEqual([5, 3, 2, 1, 2]);
  const single = fixture(() => {
    throw new ScanError('REQUEST_SIZE');
  });
  single.options.entries = generatedEntries(1);
  await runBatches(single.options);
  expect(single.files[0]?.labels[0]?.category).toBe('unclear');
});
test('deduplicates text but applies every item, respects the 50-entry cap and skips only matching checks', async () => {
  const h = fixture();
  h.options.entries = generatedEntries(60).map((e) => ({
    ...e,
    platform: 'x',
    kind: 'post',
    text: 'The same generated text.',
  }));
  h.options.limit = 50;
  const result = await runBatches(h.options);
  expect(result.stored).toBe(50);
  expect(h.requests).toHaveLength(1);
  expect(h.files[0]?.labels).toHaveLength(50);
  const checked = fixture();
  checked.options.entries = generatedEntries(1).map((e) => ({
    ...e,
    checked: [
      {
        sourceKind: 'model',
        sourceName: 'generated',
        version: sourceVersion('generated-model'),
        criteria: criteria.map(({ id, hash }) => ({ id, hash })),
      },
    ],
  }));
  expect((await runBatches(checked.options)).skipped).toBe(1);
  expect(checked.requests).toHaveLength(0);
  checked.options.answeringModel = 'another-model';
  checked.options.source = {
    ...checked.options.source,
    check: (request) =>
      Promise.resolve({ ...valid(request), answeredBy: 'another-model' }),
  };
  expect((await runBatches(checked.options)).stored).toBe(1);
});
test('groups only missing criteria, keeps warmup serial, then never exceeds requested parallelism', async () => {
  let active = 0;
  let peak = 0;
  const h = fixture(async (request) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return valid(request);
  });
  h.options.parallelRequests = 4;
  h.options.entriesPerRequest = 10;
  h.options.entries[0]!.checked = [
    {
      sourceKind: 'model',
      sourceName: 'generated',
      version: sourceVersion('generated-model'),
      criteria: [{ id: criteria[0]!.id, hash: criteria[0]!.hash }],
    },
  ];
  await runBatches(h.options);
  expect(h.requests[0]?.criteria).toHaveLength(1);
  expect(peak).toBe(4);
});
test('two truncated responses halve later batches, and five responses with no valid entry stop', async () => {
  const h = fixture((request) => ({ ...valid(request), truncated: true }));
  h.options.entries = generatedEntries(50);
  h.options.entriesPerRequest = 10;
  const result = await runBatches(h.options);
  expect(h.requests.slice(0, 3).map((r) => r.entries.length)).toEqual([
    10, 10, 5,
  ]);
  expect(result.batchSize).toBeLessThan(10);
  const invalid = fixture((request) => ({ ...valid(request), entries: [] }));
  invalid.options.entriesPerRequest = 1;
  invalid.options.entries = generatedEntries(6);
  await expect(runBatches(invalid.options)).rejects.toThrow('ANSWERS_INVALID');
  expect(invalid.requests).toHaveLength(5);
});
test('transient responses retry only requests, busy persistence retries only the same submission', async () => {
  const h = fixture((request, i) => {
    if (i === 0 || i === 1) throw new ScanError('RETRYABLE_STATUS');
    return valid(request);
  });
  h.options.entries = generatedEntries(1);
  let writes = 0;
  h.options.submit = (file) => {
    writes++;
    h.files.push(file);
    if (writes < 3) return Promise.reject(new ScanError('WORKSPACE_BUSY'));
    return Promise.resolve();
  };
  await runBatches(h.options);
  expect(h.waits).toEqual([10, 60, 10, 60]);
  expect(h.requests).toHaveLength(3);
  expect(new Set(h.files.map((f) => f.submissionId)).size).toBe(1);
});
test.each([
  'MODEL_CHANGED',
  'ENDPOINT_UNAUTHORIZED',
  'ENDPOINT_RATE_LIMITED',
  'TLS',
] as const)(
  'closed failure %s never persists or silently switches a source',
  async (code) => {
    const h = fixture((request) => {
      if (code === 'MODEL_CHANGED')
        return { ...valid(request), answeredBy: 'other' };
      throw new ScanError(code);
    });
    await expect(runBatches(h.options)).rejects.toThrow(
      code === 'TLS' ? 'ENDPOINT_UNREACHABLE' : code,
    );
    expect(h.files).toHaveLength(0);
  },
);
test('stop aborts before a batch write; first connection failure never retries', async () => {
  const controller = new AbortController();
  const h = fixture((request) => {
    controller.abort();
    return valid(request);
  });
  h.options.signal = controller.signal;
  await expect(runBatches(h.options)).rejects.toThrow('RUN_STOPPED');
  expect(h.files).toHaveLength(0);
  const connection = fixture(() => {
    throw new ScanError('CONNECTION');
  });
  await expect(runBatches(connection.options)).rejects.toThrow(
    'ENDPOINT_UNREACHABLE',
  );
  expect(connection.requests).toHaveLength(1);
});
test('resume skips written checks and an identical replay has an identical submission ID', async () => {
  const h = fixture();
  h.options.entries = generatedEntries(2);
  await runBatches(h.options);
  const id = h.files[0]!.submissionId;
  await runBatches(h.options);
  expect(h.files[1]!.submissionId).toBe(id);
  h.options.entries.forEach((e) => {
    e.checked = [
      {
        sourceKind: 'model',
        sourceName: 'generated',
        version: sourceVersion('generated-model'),
        criteria,
      },
    ];
  });
  expect((await runBatches(h.options)).stored).toBe(0);
});
test('exhausted transient retries stop after three attempts and preserve the waits', async () => {
  const h = fixture(() => {
    throw new ScanError('RETRYABLE_STATUS', 12);
  });
  await expect(runBatches(h.options)).rejects.toThrow(
    'ENDPOINT_RETRY_EXHAUSTED',
  );
  expect(h.requests).toHaveLength(3);
  expect(h.waits).toEqual([12, 12]);
  expect(h.files).toHaveLength(0);
});
test('thirty-two criteria work and thirty-three are refused before a request', async () => {
  const h = fixture();
  h.options.entries = generatedEntries(1);
  h.options.criteria = Array.from({ length: 32 }, (_, index) => ({
    id: `generated-${index}`,
    hash: 'generated',
    label: 'Generated',
    definition: 'Generated definition.',
  }));
  expect((await runBatches(h.options)).stored).toBe(1);
  h.options.criteria.push({
    id: 'extra',
    hash: 'generated',
    label: 'Generated',
    definition: 'Generated definition.',
  });
  await expect(runBatches(h.options)).rejects.toThrow('SOURCE_FILE_INVALID');
  expect(h.requests).toHaveLength(1);
});
test('a terminal response aborts other in-flight requests before any later write', async () => {
  const h = fixture(async (request, index, signal) => {
    if (index === 0) return valid(request);
    if (index === 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...valid(request), answeredBy: 'changed' };
    }
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener(
        'abort',
        () => reject(new ScanError('RUN_STOPPED')),
        { once: true },
      ),
    );
    return valid(request);
  });
  h.options.entries = generatedEntries(5);
  h.options.entriesPerRequest = 1;
  h.options.parallelRequests = 4;
  await expect(runBatches(h.options)).rejects.toThrow('MODEL_CHANGED');
  expect(h.files).toHaveLength(1);
});
