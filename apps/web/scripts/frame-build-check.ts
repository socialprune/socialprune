import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const expected = process.argv[2];
if (expected !== 'plain' && expected !== 'attribution')
  throw Error('Expected plain or attribution.');
const assets = resolve(import.meta.dirname, '../dist/assets');
let marker = false;
for (const name of await readdir(assets)) {
  if (!name.endsWith('.js')) continue;
  const source = await readFile(resolve(assets, name), 'utf8');
  if (source.includes('__spFrameAttribution')) marker = true;
  for (const observer of [
    '__scaleActivity',
    '__scaleFinishScroll',
    'outliersOver50Ms',
  ])
    if (source.includes(observer))
      throw Error('Test-page scroll observer reached a shipped bundle.');
}
if (marker !== (expected === 'attribution'))
  throw Error('Frame probe build boundary mismatch.');
console.log(`Frame probe consumption boundary verified: ${expected}.`);
