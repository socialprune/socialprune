import { readdir, readFile } from 'node:fs/promises';
import { ItemSchema, normalize, readJsonl, digest } from './contract.mjs';
import { sourceIdentity } from './provenance.mjs';

const directory = new URL('results/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
const current = (await sourceIdentity()).hash;
const smoke = (await readJsonl(new URL('smoke.jsonl', import.meta.url))).map(row => ItemSchema.parse(row));
const smokeHash = digest(await readFile(new URL('smoke.jsonl', import.meta.url)));
const expected = ['rules/default', 'ollama/qwen3:0.6b', 'ollama/qwen3:1.7b',
  'webllm/Qwen3-0.6B-q4f16_1-MLC', 'webllm/Qwen3-1.7B-q4f16_1-MLC', 'mdeberta/default'];
const found = new Map();
for (const file of files) {
  const result = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
  if (result.set !== 'smoke') throw new Error('Evaluation result exists during start-only S2');
  if (result.sourceIdentity?.hash !== current) continue;
  if (result.datasetHash !== smokeHash || result.labelsHash !== null) throw new Error('Smoke identity mismatch');
  if (result.runtimeError) continue;
  if (result.rows.length !== smoke.length) throw new Error('Missing smoke outputs');
  for (let i = 0; i < smoke.length; i++) {
    const row = result.rows[i], item = smoke[i];
    if (row.itemId !== item.id || !row.transportOk) throw new Error('Smoke transport did not return every item');
    const normalized = normalize(item, row.raw, row.assessment.source, row.assessment.createdAt);
    if (JSON.stringify(normalized.assessment) !== JSON.stringify(row.assessment) || normalized.invalid !== row.invalid ||
      normalized.nonVerbatim !== row.nonVerbatim) throw new Error('Stored normalization differs from core validator');
  }
  let model = result.modelIdentity?.canonical ?? result.modelIdentity?.requested ?? 'default';
  if (result.tier === 'mdeberta' || result.tier === 'rules') model = 'default';
  if (result.tier === 'ollama' && (result.modelIdentity.answered.length !== 1 || result.modelIdentity.answered[0] !== model)) throw new Error('Answering Ollama model unproven');
  const row = { file, tier: result.tier, model, returned: 8, invalid: result.rows.filter(row => row.invalid).length,
    nonVerbatim: result.rows.filter(row => row.nonVerbatim).length, initializationMs: result.initializationMs,
    meanLatencyMs: result.rows.reduce((sum, row) => sum + row.latencyMs, 0) / 8, identity: result.modelIdentity };
  found.set(`${result.tier}/${model}`, row);
}
for (const id of expected) if (!found.has(id)) throw new Error(`No fresh source-bound smoke proof for ${id}`);
console.log('SOURCE_BOUND_SMOKE_PROOF', current);
for (const row of found.values()) {
  const weights = row.identity.cache?.filter(entry => /(?:params_shard_\d+\.bin|model_quantized\.onnx)$/.test(entry.url)) ?? [];
  console.log(JSON.stringify({ ...row, identity: undefined, modelBytes: row.identity.size ?? weights.reduce((sum, entry) => sum + entry.bytes, 0),
    cachedArtifactBytes: row.identity.cache?.reduce((sum, entry) => sum + entry.bytes, 0),
    profileBytes: row.identity.profileBytes, profile: row.identity.profile, revision: row.identity.revision ?? row.identity.digest,
    externalOrigins: row.identity.externalOrigins }));
}
