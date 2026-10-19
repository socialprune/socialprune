import { expect, test } from 'vitest';
import { assertNoOwnedNetwork } from '../packaging/network-check.ts';

test('owned listeners, connections and UDP endpoints each fail, including descendants outside install root', () => {
  const baseline = {
    ticks: 3,
    observed: ['20|10|generated.exe|1'],
    violations: [] as string[],
  };
  expect(() => assertNoOwnedNetwork(baseline)).not.toThrow();
  for (const kind of ['listener', 'connection', 'udp'])
    expect(() =>
      assertNoOwnedNetwork({
        ...baseline,
        violations: [`${kind}|20|127.0.0.1:4669`],
      }),
    ).toThrow(`OWNED_NETWORK:${kind}`);
  expect(() => assertNoOwnedNetwork({ ...baseline, ticks: 0 })).toThrow(
    'NETWORK_OBSERVATION_MISSING',
  );
});
