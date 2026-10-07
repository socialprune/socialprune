import { readFile, writeFile } from 'node:fs/promises';
import { generateTypes } from './i18n-catalog.ts';
import type { Catalog } from './i18n-catalog.ts';

const en = JSON.parse(
  await readFile(new URL('../src/i18n/en.json', import.meta.url), 'utf8'),
) as Catalog;
await writeFile(
  new URL('../src/i18n/messages.d.ts', import.meta.url),
  await generateTypes(en),
);
console.log(`Generated types for ${Object.keys(en).length} messages.`);
