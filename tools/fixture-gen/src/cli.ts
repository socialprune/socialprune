import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as instagram from './instagram/index.ts';
import { checkFixtures, generateFixtures } from './tree.ts';
import { FIXTURES_ROOT } from './load.ts';
import * as x from './x/index.ts';

const generators = { x, instagram };
const usage = [
  'Usage: fixture-gen generate | check [--platform <id>]',
  '       fixture-gen large --platform <id> --count <n> --out <file.zip> [--seed <n>] [--zip64]',
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
      zip64: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const command = positionals[0];
  const registered = Object.keys(generators) as (keyof typeof generators)[];
  const platform = values.platform;
  if (platform && !registered.includes(platform as keyof typeof generators))
    throw new Error('Unknown fixture platform.');
  const selected = platform
    ? [platform as keyof typeof generators]
    : registered;
  const variants = selected.flatMap((id) => generators[id].variants);
  if (values.help) {
    console.log(usage);
  } else if (positionals.length !== 1) {
    console.error(usage);
    process.exitCode = 2;
  } else if (command === 'generate' || command === 'check') {
    if (Object.keys(values).some((key) => key !== 'platform'))
      throw new Error('Unexpected options.');
    if (command === 'generate') {
      await generateFixtures(FIXTURES_ROOT, variants, selected);
      console.log(`Generated ${variants.length} fixture variant(s).`);
    } else {
      const drift = await checkFixtures(FIXTURES_ROOT, variants, selected);
      for (const path of drift)
        console.error(`Fixture drift: ${JSON.stringify(path)}`);
      process.exitCode = drift.length > 0 ? 1 : 0;
      console.log(
        `Fixtures: ${variants.length} variant(s), ${drift.length} changed file(s).`,
      );
    }
  } else if (command === 'large') {
    if (!values.out || !values.count || !platform) {
      throw new Error(
        'Large generation requires --platform and an explicit --out path.',
      );
    }
    const generator = generators[platform as keyof typeof generators];
    await generator.generateLarge({
      out: resolve(values.out),
      count: integer(values.count, 1),
      seed: integer(values.seed ?? '1', 0),
      zip64: values.zip64 ?? false,
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
