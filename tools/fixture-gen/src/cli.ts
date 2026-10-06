import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as instagram from './instagram/index.ts';
import { checkFixtures, writeVariants } from './tree.ts';
import * as x from './x/index.ts';

const fixturesRoot = fileURLToPath(
  new URL('../../../fixtures/synthetic/', import.meta.url),
);
const usage = [
  'Usage: fixture-gen generate | check',
  '       fixture-gen large --platform x|instagram --out <path> [--count <n>] [--seed <n>]',
].join('\n');

function integer(value: string, minimum: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error('Count and seed must be valid integers.');
  }
  return number;
}

try {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      platform: { type: 'string' },
      out: { type: 'string' },
      count: { type: 'string' },
      seed: { type: 'string' },
    },
    allowPositionals: true,
  });
  const command = positionals[0];
  const variants = [...x.variants, ...instagram.variants];
  if (values.help) {
    console.log(usage);
  } else if (positionals.length !== 1) {
    console.error(usage);
    process.exitCode = 2;
  } else if (command === 'generate' || command === 'check') {
    if (Object.keys(values).length !== 0)
      throw new Error('Unexpected options.');
    if (command === 'generate') {
      await writeVariants(fixturesRoot, variants);
      console.log(`Generated ${variants.length} fixture variant(s).`);
    } else {
      const drift = await checkFixtures(fixturesRoot, variants);
      for (const path of drift)
        console.error(`Fixture drift: ${JSON.stringify(path)}`);
      process.exitCode = drift.length > 0 ? 1 : 0;
      console.log(
        `Fixtures: ${variants.length} variant(s), ${drift.length} changed file(s).`,
      );
    }
  } else if (command === 'large') {
    if (
      !values.out ||
      (values.platform !== 'x' && values.platform !== 'instagram')
    ) {
      throw new Error(
        'Large generation requires --platform and an explicit --out path.',
      );
    }
    const generator = values.platform === 'x' ? x : instagram;
    await generator.generateLarge({
      out: resolve(values.out),
      count: integer(values.count ?? '100000', 1),
      seed: integer(values.seed ?? '1', 0),
    });
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Fixture generation failed.',
  );
  process.exitCode = 1;
}
