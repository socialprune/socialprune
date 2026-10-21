import { additions, materializeAdditions } from '../../fixtures/synthetic/classify/additions-v2.mjs';
import { readJsonl, validateItems, fixtureDirectory, digest } from './contract.mjs';

export function validateAdditionTexts(items) {
  const framed = items.filter(item => /erfunden|fiktiv|fictional|invented|made[-\s]+up/iu.test(item.text));
  if (framed.length) throw new Error(`FICTION_FRAME: ${framed.length} new item texts (${framed.map(item => item.id).join(', ')})`);
  return items;
}

export async function loadDataset() {
  const base = await readJsonl(new URL('items.jsonl', fixtureDirectory));
  const extra = validateAdditionTexts(materializeAdditions());
  const items = validateItems([...base, ...extra]);
  const design = [...await readJsonl(new URL('design.jsonl', fixtureDirectory)), ...additions.map((row, i) => ({
    itemId: extra[i].id, language: row.language, phenomena: row.phenomena, focus: row.focus, role: row.role, overlap: row.overlap,
  }))];
  const newIds = extra.map(item => item.id);
  // Fixed reading order mixes authoring blocks without exposing their coverage intentions.
  let seed = 20261020;
  for (let i = newIds.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [newIds[i], newIds[j]] = [newIds[j], newIds[i]];
  }
  return { items, design, newIds, hash: digest(JSON.stringify(items)) };
}
