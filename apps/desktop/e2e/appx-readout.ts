import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appxHistory } from './appx-history.ts';

type RecordValue = Record<string, unknown>;
type FirewallRow = {
  key: string;
  count: number;
  row: RecordValue & { package?: string };
};
type Observation = RecordValue & {
  kind: string;
  at: number;
  endedAt?: number;
  initial?: boolean;
  changes?: { reason: string; entry: FirewallRow }[];
};
type Phase = { phase: string; at: number; pid?: number };

export function appxReadout(
  observations: Observation[],
  phases: Phase[],
  arm: string,
) {
  const ordered = [...phases].sort((a, b) => a.at - b.at);
  const firstProduct = ordered.find((row) =>
    /^(desktop-build-start|restricted-launch|proof-)/.test(row.phase),
  );
  const samples = observations.filter((row) => row.kind === 'firewall');
  const gaps = observations.filter((row) => row.kind === 'observation-error');
  const initial = samples.find((row) => row.initial);
  const current = new Map<string, FirewallRow>();
  const appearances: RecordValue[] = [];
  let previous: Observation | undefined;
  for (const sample of samples) {
    for (const change of sample.changes ?? []) {
      if (change.reason === 'removed') current.delete(change.entry.key);
      else current.set(change.entry.key, change.entry);
      if (
        !['NarratorQuickStart', 'FeedbackHub'].includes(
          change.entry.row.package ?? '',
        ) ||
        change.reason === 'removed'
      )
        continue;
      // Enumeration is not atomic. A prior scan can miss a rule added after it
      // passed that position, so the conservative lower bound is its start.
      const lower = sample.initial ? null : (previous?.at ?? null);
      const upper = sample.endedAt ?? sample.at;
      const nearest = ordered.filter((row) => row.at <= upper).at(-1) ?? null;
      appearances.push({
        package: change.entry.row.package,
        count: change.entry.count,
        initial: sample.initial === true,
        key: change.entry.key,
        owner: change.entry.row.owner,
        ownerHash: change.entry.row.ownerHash,
        packageSidHash: change.entry.row.packageSidHash,
        configurationHash: change.entry.row.configurationHash,
        intervalStart: lower,
        intervalEnd: upper,
        nearestPhase: nearest,
        beforeFirstProduct: !firstProduct
          ? 'no-product-step-in-arm'
          : upper < firstProduct.at
            ? 'yes'
            : lower !== null && lower >= firstProduct.at
              ? 'no'
              : 'interval-overlaps-product-step',
      });
    }
    previous = sample;
  }
  const packages = ['NarratorQuickStart', 'FeedbackHub'].map((name) => {
    const first = appearances.find((row) => row.package === name);
    return {
      package: name,
      initialCount: (initial?.changes ?? [])
        .filter((c) => c.entry.row.package === name)
        .reduce((n, c) => n + c.entry.count, 0),
      finalCount: [...current.values()]
        .filter((r) => r.row.package === name)
        .reduce((n, r) => n + r.count, 0),
      firstAppearance: first ?? null,
      appearedWithoutProduct:
        arm === 'idle'
          ? first
            ? 'yes-during-observation-or-already-present'
            : gaps.some((g) => g.operation === 'firewall') || !initial
              ? 'unknown-observation-gap'
              : 'not-observed'
          : 'not-idle-arm',
    };
  });
  return {
    diagnosticOnly: true,
    acceptanceProof: false,
    arm,
    history: appxHistory,
    firstProductStep: firstProduct ?? null,
    packages,
    appearances,
    phases: ordered,
    coverage: {
      firewallSamples: samples.length,
      firstSample: initial?.at ?? null,
      lastSample: samples.at(-1)?.endedAt ?? samples.at(-1)?.at ?? null,
      maximumSampleGapMs:
        samples.length < 2
          ? null
          : Math.max(
              ...samples
                .slice(1)
                .map(
                  (row, i) => row.at - (samples[i]!.endedAt ?? samples[i]!.at),
                ),
            ),
      observationErrors: gaps,
      channels: observations.filter((row) => row.kind === 'channel'),
      eventCoverage: observations.filter(
        (row) => row.kind === 'event-coverage',
      ),
      settled: observations.some((row) => row.kind === 'settled'),
    },
    attribution:
      'First appearance and phase association are timing evidence, not modifying-process proof; idle observation also invokes read-only Windows enumeration.',
  };
}

export async function writeAppxReadout(
  output: string,
  proofDirectory: string,
  arm: string,
) {
  const observations = (
    await readFile(join(output, 'observations.jsonl'), 'utf8')
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Observation);
  const phases: Phase[] = [];
  for (const [folder, prefix] of [
    [output, 'phase-'],
    [proofDirectory, 'release-appx-phase-'],
  ] as const) {
    for (const name of await readdir(folder)) {
      if (name.startsWith(prefix) && name.endsWith('.json'))
        phases.push(
          JSON.parse(await readFile(join(folder, name), 'utf8')) as Phase,
        );
    }
  }
  const result = appxReadout(observations, phases, arm);
  await writeFile(
    join(output, 'readout.json'),
    JSON.stringify(result, null, 2),
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [output, proofs, arm] = process.argv.slice(2);
  if (
    !output ||
    !proofs ||
    !['idle', 'restricted', 'installed'].includes(arm ?? '')
  )
    throw new Error('APPX_READOUT_ARGUMENTS');
  console.log(
    JSON.stringify(await writeAppxReadout(output, proofs, arm!), null, 2),
  );
}
