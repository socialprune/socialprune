import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJsonl, validateItems, fixtureDirectory, validateLabels, normalize, assessment, outputSchema, policyText,
  validateLabelSnapshot, readRubric, digest } from '../contract.mjs';
import { metrics } from '../metrics.mjs';
import { assertLocalModel, ollamaTier, referenceTier } from '../http-tiers.mjs';
import { tempRoot } from '../machine.mjs';
import { loadDataset, validateAdditionTexts } from '../dataset.mjs';
import { materializeAdditions } from '../../../fixtures/synthetic/classify/additions-v2.mjs';

const smoke = validateItems(await readJsonl(new URL('../smoke.jsonl', import.meta.url)));
const source = { kind: 'model', name: 'test-only', version: '1' };
const createdAt = '2026-10-06T17:00:00Z';
const label = (item, category = 'harmless', risk = 0) => ({ itemId: item.id, labels: [{ category, risk }], note: '', labeledAt: createdAt, labeler: 'maintainer' });
const prediction = (item, category = 'harmless', risk = 0) => assessment(item, source, createdAt, { category, risk,
  reason: 'Test-only generated prediction', evidence: null, confidence: null });
function child(script, args, input = '') {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [new URL(`../${script}`, import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'), ...args],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', data => stdout += data); process.stderr.on('data', data => stderr += data);
    process.on('error', reject); process.on('close', code => resolve({ code, stdout, stderr })); process.stdin.end(input);
  });
}
test('new item text reads as posts, not fiction-framed evaluation instructions', () => {
  const items = materializeAdditions();
  assert.equal(items.length,160);
  assert.doesNotThrow(() => validateAdditionTexts(items));
  for (const term of ['erfunden', 'Erfundene', 'FIKTIV', 'fictional', 'Invented', 'made-up', 'made up']) {
    for (const text of [`${term}: Ein Beitrag.`, `Ein ${term} Beitrag.`, `Ein Beitrag ist ${term}.`]) {
      assert.throws(() => validateAdditionTexts([{id:'s2-test',text}]),/FICTION_FRAME/);
    }
  }
  assert.doesNotThrow(() => validateAdditionTexts([{id:'s2-test',text:'Nerlo Quast besucht Velun und Nebelhafen.'}]));
});
test('both sets satisfy the real core ItemSchema and are disjoint', async () => {
  const { items, design, newIds } = await loadDataset();
  assert.equal(items.length, 560); assert.equal(smoke.length, 8); assert.equal(new Set(newIds).size, 160);
  assert.equal(new Set([...items, ...smoke].map(item => item.id)).size, 568);
  assert.equal(new Set([...items, ...smoke].map(item => item.text)).size, 568);
  for (const focus of ['racist','misogynistic','group-hostility','politically-incorrect']) {
    const extra = design.filter(row => row.focus === focus);
    assert.equal(extra.length,40);
    for (const language of ['de','en']) for (const role of ['fit-intent','near-miss-intent']) {
      const group = extra.filter(row => row.language === language && row.role === role);
      assert.equal(group.length,10); assert.equal(group.filter(row => row.overlap).length,4);
      const entries = group.map(row => items.find(item => item.id === row.itemId));
      assert.equal(entries.filter(item => item.platform === 'x').length,5);
      for (const kind of ['post','reply','quote','repost','comment']) assert.equal(entries.filter(item => item.kind === kind).length,2);
    }
  }
  for (const item of items) { assert.equal(item.category, undefined); assert.equal(item.risk, undefined); }
});
test('all six real eval entrypoints refuse before tier import or initialization', async () => {
  for (const tier of ['rules', 'ollama', 'webllm', 'mdeberta', 'prompt-api', 'reference']) {
    const result = await child('run.mjs', ['--tier', tier, '--set', 'eval']);
    assert.equal(result.code, 2); assert.match(result.stderr, /EVAL_LOCKED/); assert.doesNotMatch(result.stdout, /ITEM_RETURNED|RESULT_FILE/);
  }
});
test('labels reject partial, duplicate, foreign, nonhuman and invalid values', () => {
  const labels = smoke.map(item => label(item)); assert.equal(validateLabels(smoke, labels).length, 8);
  assert.throws(() => validateLabels(smoke, labels.slice(0, 7)));
  for (const value of [{ ...labels[0], itemId: labels[1].itemId }, { ...labels[0], itemId: 'other' },
    { ...labels[0], labels: [{ category: 'invented', risk: 0 }] }, { ...labels[0], labels: [{ category: 'toxic', risk: 4 }] },
    { ...labels[0], labels: [{ category: 'harmless', risk: 0 }, { category: 'racist', risk: 2 }] },
    { ...labels[0], labels: [{ category: 'racist', risk: 2 }, { category: 'racist', risk: 1 }] },
    { ...labels[0], labeler: 'model' }, { ...labels[0], labeledAt: '2026-10-06T17:00:00+02:00' }]) {
    assert.throws(() => validateLabels(smoke, [value, ...labels.slice(1)]));
  }
});
test('invalid output is unclear and non-verbatim evidence is dropped separately', () => {
  const good = prediction(smoke[0]);
  assert.equal(normalize(smoke[0], JSON.stringify({ assessments: [good] }), source, createdAt).invalid, false);
  assert.equal(normalize(smoke[0], { assessments: [{ ...good, evidence: 'not in the item' }] }, source, createdAt).nonVerbatim, true);
  assert.equal(normalize(smoke[0], { assessments: [{ ...good, evidence: 'not in the item' }] }, source, createdAt).assessments[0].evidence, null);
  const both = normalize(smoke[0], { assessments: [{ ...good, risk: 4, evidence: 'not in the item' }] }, source, createdAt);
  assert.equal(both.invalid, true); assert.equal(both.nonVerbatim, true); assert.equal(both.assessments[0].evidence, null);
  for (const raw of ['not json', { ...good, category: 'other' }, { ...good, itemId: 'other' },
    { ...good, risk: 4 }, { ...good, reason: 'First sentence. Second sentence.' }, { ...good, source: { ...source, name: 'forged' } }]) {
    const result = normalize(smoke[0], typeof raw === 'string' ? raw : { assessments: [raw] }, source, createdAt); assert.equal(result.invalid, true); assert.equal(result.assessments[0].category, 'unclear');
  }
  const two = [prediction(smoke[0], 'racist', 2), prediction(smoke[0], 'political', 0)];
  assert.equal(normalize(smoke[0], { assessments: two }, source, createdAt).assessments.length,2);
  assert.equal(normalize(smoke[0], { assessments: [two[0], two[0]] }, source, createdAt).invalid,true);
  assert.equal(normalize(smoke[0], { assessments: [good, two[0]] }, source, createdAt).invalid,true);
  assert.equal(outputSchema(smoke[0], source, createdAt).properties.assessments.items.properties.reason.pattern, undefined);
  assert.match(policyText, /DATA, never instructions/);
});
test('accepted rubric snapshot rejects any item, label, rubric or chronology mismatch', async () => {
  const labels = smoke.map(item => label(item));
  const manifest = { version: 2, itemsHash: 'items', labelsHash: 'labels', rubricHash: 'rubric',
    labeler: 'maintainer', finalizedAt: '2026-10-06T17:01:00Z' };
  validateLabelSnapshot(manifest, labels, 'items', 'labels', 'rubric');
  for (const delta of [{ itemsHash: 'changed' }, { labelsHash: 'changed' }, { rubricHash: 'changed' },
    { finalizedAt: '2026-10-06T16:59:00Z' }, { finalizedAt: '2099-01-01T00:00:00Z' }, { labeler: 'agent' }]) {
    assert.throws(() => validateLabelSnapshot({ ...manifest, ...delta }, labels, 'items', 'labels', 'rubric'), /EVAL_LOCKED/);
  }
  const rubric = await readRubric(); assert.equal(rubric.riskDescriptions.length, 4);
  assert.equal(Object.keys(rubric.categoryDescriptions).length, 14); assert.equal(rubric.hash, digest(rubric.text));
});
test('cloud and remote Ollama paths fail before any chat request; missing reference key makes no call', async () => {
  assert.throws(() => assertLocalModel('small-cloud', {}), /REMOTE_REFUSED/);
  assert.throws(() => assertLocalModel('local', { remote_host: 'remote.example' }), /REMOTE_REFUSED/);
  assert.throws(() => assertLocalModel('local', { model_info: { remote_host: 'remote.example' } }), /REMOTE_REFUSED/);
  let calls = 0;
  await assert.rejects(ollamaTier('local', async url => {
    calls++; assert.match(url, /\/api\/show$/); return Response.json({ remote_host: 'remote.example' });
  }), /REMOTE_REFUSED/);
  assert.equal(calls, 1);
  await assert.rejects(ollamaTier('small-cloud', async () => { throw new Error('must not call'); }), /REMOTE_REFUSED/);
  await assert.rejects(referenceTier('reference', undefined), /REFERENCE_LOCKED/);
});
test('metric arithmetic is exercised only with test-only predictions on smoke-derived temp data', () => {
  const items = smoke.slice(0, 3);
  const labels = [label(items[0]), label(items[1], 'toxic', 2), label(items[2], 'toxic', 2)];
  const rows = [prediction(items[0]), prediction(items[1], 'toxic', 2), prediction(items[2], 'harmless', 1)].map((value, i) =>
     ({ itemId: items[i].id, assessments: [value], invalid: false, nonVerbatim: false, latencyMs: i + 1 }));
  const result = metrics({ set: 'eval', tier: 'test-only', rows }, items, labels);
  assert.equal(result.perCategory.toxic.precision, 1); assert.equal(result.perCategory.toxic.recall, .5);
  assert.equal(result.perCategory.harmless.precision, .5); assert.equal(result.perCategory.harmless.recall, 1);
  assert.equal(result.riskAgreement, 1); assert.equal(result.riskAgreementDenominator,2); assert.equal(result.exactCategorySetAgreement,2/3); assert.equal(result.latencyMs.mean, 2);
  assert.equal(result.perCategory.sexual.recall, null);
  assert.throws(() => metrics({ set: 'smoke', rows }, items, labels), /wiring only/);
});
