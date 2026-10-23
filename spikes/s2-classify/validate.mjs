import { access } from 'node:fs/promises';
import { readJsonl, validateItems, readRubric } from './contract.mjs';
import { loadDataset } from './dataset.mjs';

const { items, design, newIds } = await loadDataset();
const rubric = await readRubric();
const smoke = validateItems(await readJsonl(new URL('smoke.jsonl', import.meta.url)));
if (items.length !== 560 || smoke.length !== 8 || design.length !== items.length || newIds.length !== 160) throw new Error('Wrong set sizes');
if (new Set([...items, ...smoke].map(item => item.id)).size !== items.length + smoke.length ||
  new Set([...items, ...smoke].map(item => item.text)).size !== items.length + smoke.length) throw new Error('Smoke/eval overlap');
const ids = new Set(items.map(item => item.id));
const seen = new Set();
for (const row of design) {
  if (!ids.has(row.itemId) ||
    seen.has(row.itemId) || !['de', 'en'].includes(row.language) || !Array.isArray(row.phenomena) ||
    !row.phenomena.length || row.phenomena.some(value => typeof value !== 'string' || !value)) throw new Error('Invalid design record');
  seen.add(row.itemId);
}
for (const item of items) if (!['x', 'instagram'].includes(item.platform) || item.provenance.archive !== 's2-eval' ||
  !/^s2-\d{3}$/.test(item.id) || 'category' in item || 'risk' in item) throw new Error('Unlabelled item invariant');
const extra = items.filter(item => newIds.includes(item.id));
const placeholders = extra.flatMap(item => item.text.match(/\[Schimpfwort\]|\[slur\]/g) ?? []).length;
if (placeholders !== 12) throw new Error('Expected the 12 fixed slur placeholders');
for (const file of ['labels.jsonl', 'labels.history.jsonl', 'labels.manifest.json']) {
  try { await access(new URL(`local/${file}`, import.meta.url)); console.log('HUMAN_STATE_PRESENT', file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; console.log('HUMAN_STATE_ABSENT', file); }
}
function counts(values) { const result = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
console.log(JSON.stringify({ validatedEval: items.length, validatedSmoke: smoke.length, uniqueIdsAndTexts: true,
  criterionCount: rubric.criteria.length, criteriaHash: rubric.criteriaHash, slurPlaceholders: placeholders,
  language: counts(design.map(row => row.language)), platform: counts(items.map(item => item.platform)),
  kind: counts(items.map(item => item.kind)), phenomena: counts(design.flatMap(row => row.phenomena)),
  years: counts(items.map(item => item.createdAt.slice(0, 4))),
  unknownLikes: items.filter(item => item.engagement.likes === null).length,
  unknownReposts: items.filter(item => item.engagement.reposts === null).length }, null, 2));
console.log('NEW_IDS', newIds.join(','));
console.log('AUTHORING_COVERAGE_NOT_LABELS');
for (const category of ['racist','misogynistic','group-hostility','politically-incorrect']) {
  const rows = design.filter(row => row.focus === category);
  console.log(category, JSON.stringify({ de: rows.filter(row => row.language === 'de').length, en: rows.filter(row => row.language === 'en').length,
    fitIntent: rows.filter(row => row.role === 'fit-intent').length, nearMissIntent: rows.filter(row => row.role === 'near-miss-intent').length,
    overlapIntents: rows.filter(row => row.overlap).length, platform: counts(rows.map(row => items.find(item => item.id === row.itemId).platform)),
    kind: counts(rows.map(row => items.find(item => item.id === row.itemId).kind)) }));
}
