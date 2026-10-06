import { writeFile, mkdir, access } from 'node:fs/promises';
import { ItemSchema } from '@socialprune/core';
import { corpus } from './corpus.mjs';

const directory = new URL('../../fixtures/synthetic/classify/', import.meta.url);
for (const file of ['labels.jsonl', 'labels.history.jsonl', 'labels.manifest.json']) {
  try { await access(new URL(file, directory)); throw new Error('Refusing to regenerate a set with human label state'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (corpus.length !== 400 || new Set(corpus.map(row => row.text)).size !== 400) throw new Error('Expected 400 distinct authored texts');
let state = 20261006;
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
const shuffled = [...corpus];
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const kinds = ['post', 'reply', 'quote', 'repost', 'comment'];
const rows = shuffled.map((row, index) => {
  const id = `s2-${String(index + 1).padStart(3, '0')}`;
  const kind = kinds[index % kinds.length];
  const year = 2012 + index % 15;
  const platform = index % 2 ? 'instagram' : 'x';
  const item = ItemSchema.parse({ id, platform, account: { key: `s2-${platform}-invented`, handle: 'zava_fenn_demo' },
    kind, text: row.text, createdAt: new Date(Date.UTC(year, index % (year === 2026 ? 9 : 12), 1 + index % 27, index % 24, index % 60)).toISOString(),
    engagement: { likes: index % 7 === 0 ? null : (index * 13) % 57, reposts: index % 9 === 0 ? null : (index * 3) % 8 },
    reference: { replyToId: kind === 'reply' ? `invented-parent-${index}` : null,
      replyToHandle: kind === 'reply' ? 'nerlo_quast_demo' : null,
      quotedId: kind === 'quote' ? `invented-quote-${index}` : null,
      repostOfHandle: kind === 'repost' ? 'veska_dorn_demo' : null,
      ownerHandle: kind === 'comment' ? 'jolvi_nebel_demo' : null },
    url: index % 11 === 0 ? null : `https://example.org/s2/${id}`,
    provenance: { archive: 's2-eval', file: 'invented-posts.jsonl', index } });
  const phenomena = [...row.phenomena];
  if (kind === 'quote') phenomena.push('quotation-context');
  if (kind === 'repost') phenomena.push('reshare-context');
  if (kind === 'reply' || kind === 'comment') phenomena.push('reply-context');
  return { item, design: { itemId: id, language: row.language, phenomena } };
});
await mkdir(directory, { recursive: true });
await writeFile(new URL('items.jsonl', directory), rows.map(row => JSON.stringify(row.item)).join('\n') + '\n');
await writeFile(new URL('design.jsonl', directory), rows.map(row => JSON.stringify(row.design)).join('\n') + '\n');
console.log('AUTHORED_UNLABELLED_ITEMS', rows.length, 'SHUFFLE_SEED', 20261006);
