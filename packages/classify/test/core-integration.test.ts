import { expect, test } from 'vitest';
import { PRESETS } from '@socialprune/core/criteria';
import { LabelService } from '@socialprune/core/workspace/labels';
import { SourceLabelFileSchema } from '@socialprune/core/workspace/payloads';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { contractWorkspace } from '@socialprune/core/workspace/store-contract';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { EndpointSource } from '../src/endpoint.ts';
import { nodeTransport } from '../src/node.ts';
import { runBatches, sourceVersion } from '../src/runner.ts';
import { fakeEndpoint } from './fake-endpoint.ts';

test('real runner writes through core schema and service, skips matching model coverage and resumes without decisions', async () => {
  const initial = contractWorkspace();
  initial.settings.criteria!.selected = ['political'];
  const store = createMemoryStore(new MemoryStoreBacking(initial));
  const service = new LabelService(store);
  const fake = await fakeEndpoint();
  const transport = nodeTransport(fake.origin);
  const options = {
    shareWithAgent: true,
    sourceKind: 'model' as const,
    sourceName: 'generated',
    sourceVersion: sourceVersion('generated-model'),
  };
  try {
    const batch = await service.batchNext(options);
    expect(batch.items).toHaveLength(1);
    const entry = initial.items[0]!;
    const result = await runBatches({
      source: new EndpointSource(fake.config(), transport.transport),
      answeringModel: 'generated-model',
      confirmedOrigin: fake.origin,
      entries: [
        {
          itemId: entry.id,
          contentHash: batch.items[0]!.contentHash,
          platform: 'x',
          kind: entry.kind,
          text: entry.text,
        },
      ],
      criteria: PRESETS.filter((c) => c.id === 'political'),
      entriesPerRequest: 25,
      signal: new AbortController().signal,
      submit: (file) =>
        service.submitSourceLabels(SourceLabelFileSchema.parse(file)),
    });
    expect(result.stored).toBe(1);
    expect((await service.batchNext(options)).items).toEqual([]);
    expect(
      (
        await service.batchNext({
          ...options,
          sourceVersion: 'different-model rubric changed',
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await service.batchNext({ shareWithAgent: true })).items,
    ).toHaveLength(1);
    const saved = await store.read(readWorkspace);
    expect(saved.assessments[0]?.source.kind).toBe('model');
    expect(saved.submissions[0]?.criteria?.map((c) => c.id)).toEqual([
      'political',
    ]);
    expect(saved.decisionEvents).toEqual([]);
    expect(saved.outcomeEvents).toEqual([]);
    expect(saved.reviewPlans).toEqual([]);
  } finally {
    transport.close();
    await fake.close();
    await store.close();
  }
});
