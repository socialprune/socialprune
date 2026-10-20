import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const forbidden = [
  'W_FEED_ATELIER_ONLY_20261020',
  'SocialPrune Feed Atelier',
  'Designvorschau mit erfundenen Beiträgen. Hier wird nichts gespeichert.',
  'Design preview with invented posts. Nothing is stored here.',
  'invented-birch-1',
  'feed-design.html',
  'feed-design.config',
  'feed/design/entry',
];

async function inspect(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) count += await inspect(path);
    else {
      if (
        /feed-design|feed-incumbent|Sheet\.module|examples\.ts/.test(entry.name)
      ) {
        throw new Error(`Design-only file in shipping output: ${entry.name}`);
      }
      const content = await readFile(path, 'utf8');
      for (const value of forbidden) {
        if (content.includes(value)) {
          throw new Error(`Design-only content in shipping output: ${value}`);
        }
      }
      count++;
    }
  }
  return count;
}

for (const name of ['dist', 'dist-review', 'dist-desktop']) {
  const directory = resolve(import.meta.dirname, '..', name);
  console.log(
    JSON.stringify({
      output: name,
      files: await inspect(directory),
      designSheetAbsent: true,
    }),
  );
}

const production = await readFile(
  new URL('../vite.config.ts', import.meta.url),
  'utf8',
);
if (/feed-design|feed\/design/.test(production)) {
  throw new Error('The shipping config references the design sheet.');
}
console.log(
  'No shipping config reference; all sheet identifiers and copy absent.',
);
