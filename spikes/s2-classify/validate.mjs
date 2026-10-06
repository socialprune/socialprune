import { access } from 'node:fs/promises';
import { readJsonl, validateItems, fixtureDirectory } from './contract.mjs';

const items = validateItems(await readJsonl(new URL('items.jsonl', fixtureDirectory)));
const smoke = validateItems(await readJsonl(new URL('smoke.jsonl', import.meta.url)));
const design = await readJsonl(new URL('design.jsonl', fixtureDirectory));
if (items.length !== 400 || smoke.length !== 8 || design.length !== items.length) throw new Error('Wrong set sizes');
if (new Set([...items, ...smoke].map(item => item.id)).size !== items.length + smoke.length ||
  new Set([...items, ...smoke].map(item => item.text)).size !== items.length + smoke.length) throw new Error('Smoke/eval overlap');
const ids = new Set(items.map(item => item.id));
const seen = new Set();
for (const row of design) {
  if (Object.keys(row).sort().join() !== ['itemId', 'language', 'phenomena'].sort().join() || !ids.has(row.itemId) ||
    seen.has(row.itemId) || !['de', 'en'].includes(row.language) || !Array.isArray(row.phenomena) ||
    !row.phenomena.length || row.phenomena.some(value => typeof value !== 'string' || !value)) throw new Error('Invalid design record');
  seen.add(row.itemId);
}
for (const item of items) if (!['x', 'instagram'].includes(item.platform) || item.provenance.archive !== 's2-eval' ||
  !/^s2-\d{3}$/.test(item.id) || 'category' in item || 'risk' in item) throw new Error('Unlabelled item invariant');
for (const file of ['labels.jsonl', 'labels.history.jsonl', 'labels.manifest.json']) {
  try { await access(new URL(file, fixtureDirectory)); console.log('HUMAN_STATE_PRESENT', file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; console.log('HUMAN_STATE_ABSENT', file); }
}
function counts(values) { const result = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
console.log(JSON.stringify({ validatedEval: items.length, validatedSmoke: smoke.length, uniqueIdsAndTexts: true,
  language: counts(design.map(row => row.language)), platform: counts(items.map(item => item.platform)),
  kind: counts(items.map(item => item.kind)), phenomena: counts(design.flatMap(row => row.phenomena)),
  years: counts(items.map(item => item.createdAt.slice(0, 4))),
  unknownLikes: items.filter(item => item.engagement.likes === null).length,
  unknownReposts: items.filter(item => item.engagement.reposts === null).length }, null, 2));
