import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadSet, normalize, contractVersion, policyText, digest, readRubric } from './contract.mjs';
import { summary, metrics } from './metrics.mjs';
import { sourceIdentity } from './provenance.mjs';

function args(argv) {
  const result = {};
  const allowed = ['tier', 'set', 'model', 'key-file', 'metrics'];
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !allowed.includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--') || Object.hasOwn(result, name)) {
      throw new Error('Usage: node run.mjs --tier <rules|ollama|webllm|mdeberta|prompt-api|reference> --set <smoke|eval> [--model <name>] [--key-file <path>] OR --metrics <result.json>');
    }
    result[name] = argv[i + 1];
  }
  return result;
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.metrics) {
    if (Object.keys(options).length !== 1) throw new Error('--metrics cannot be combined with inference options');
    const result = JSON.parse(await readFile(options.metrics, 'utf8'));
    const { items, labels, datasetHash, labelsHash } = await loadSet('eval');
    if (result.datasetHash !== datasetHash || result.labelsHash !== labelsHash) throw new Error('Result does not match current item and human-label hashes');
    console.log(JSON.stringify(metrics(result, items, labels), null, 2));
    return;
  }
  if (!['rules', 'ollama', 'webllm', 'mdeberta', 'prompt-api', 'reference'].includes(options.tier)) throw new Error('--tier is required');
  // This gate deliberately precedes all tier imports and browser/model initialization.
  const { items, labels, datasetHash, labelsHash } = await loadSet(options.set);
  if (options['key-file'] && options.tier !== 'reference') throw new Error('--key-file is only allowed for the reference tier');
  const rubric = await readRubric();
  const startedAt = new Date().toISOString();
  const result = { version: 1, tier: options.tier, set: options.set, startedAt, datasetHash, labelsHash,
    contractVersion, contractHash: digest(policyText), rubricHash: rubric.hash,
    modelIdentity: null, rows: [], initializationMs: null, runtimeError: null };
  result.sourceIdentity = await sourceIdentity();
  const begin = performance.now();
  let tier;
  try {
    if (options.tier === 'rules') {
      if (options.model || options['key-file']) throw new Error('Rules accepts no model or key');
      const { rules } = await import('./rules.mjs');
      tier = { source: { kind: 'rules', name: 's2-handwritten-baseline', version: contractVersion }, identity: { name: 'handwritten patterns' },
        async classify(item, createdAt) { return { raw: rules(item, this.source, createdAt), transportOk: true }; }, async close() {} };
    } else if (options.tier === 'ollama') tier = await (await import('./http-tiers.mjs')).ollamaTier(options.model, fetch, rubric.text);
    else if (options.tier === 'reference') tier = await (await import('./http-tiers.mjs')).referenceTier(options.model, options['key-file'], rubric.text);
    else tier = await (await import('./browser-tier.mjs')).browserTier(options.tier, options.model, rubric);
    result.initializationMs = performance.now() - begin;
    for (const item of items) {
      const createdAt = new Date().toISOString(), start = performance.now();
      let answer;
      try { answer = await tier.classify(item, createdAt); }
      catch (error) { answer = { raw: null, transportOk: false, transportError: String(error.message) }; }
      const normalized = normalize(item, answer.raw, tier.source, createdAt);
      result.rows.push({ itemId: item.id, ...normalized, raw: answer.raw ?? null, latencyMs: performance.now() - start,
        transportOk: answer.transportOk, transportError: answer.transportError ?? null,
        usage: answer.usage ?? null, answeredModel: answer.answeredModel ?? null });
      console.log('ITEM_RETURNED', item.id, 'transport', answer.transportOk, 'valid', !normalized.invalid);
    }
    result.modelIdentity = tier.identity;
  } catch (error) {
    result.runtimeError = String(error.message);
    if (error.identity) result.modelIdentity = error.identity;
    process.exitCode = 2;
  }
  finally { if (tier) { await tier.close(); result.modelIdentity = tier.identity; } }
  if ((await sourceIdentity()).hash !== result.sourceIdentity.hash) {
    result.runtimeError = 'Executable source changed during the run'; process.exitCode = 2;
  }
  const directory = new URL('results/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`${startedAt.replace(/[:.]/g, '-')}-${options.tier}-${(options.model ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_')}-${options.set}.json`, directory);
  result.endedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('RESULT_FILE', file.pathname);
  if (result.runtimeError) throw new Error(result.runtimeError);
  if (options.set === 'eval') console.log(JSON.stringify(metrics(result, items, labels), null, 2));
  else console.log('SMOKE_WIRING_ONLY', JSON.stringify({ returned: result.rows.length,
    transportErrors: result.rows.filter(row => !row.transportOk).length,
    invalidOutputs: result.rows.filter(row => row.invalid).length,
    nonVerbatimEvidence: result.rows.filter(row => row.nonVerbatim).length,
    initializationMs: result.initializationMs, latencyMs: summary(result.rows).latencyMs }));
  if (result.rows.some(row => !row.transportOk)) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode ||= 2; });
