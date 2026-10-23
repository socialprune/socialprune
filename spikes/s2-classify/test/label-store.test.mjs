import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { openLabelStore } from '../label-store.mjs';
import { readJsonl, validateLabels, validateLabelSnapshot, digest, checkedCriteria, criteriaHash } from '../contract.mjs';
import { metrics, wilson } from '../metrics.mjs';

const output = process.env.SP_S2_PROOF_DIR ?? path.join(process.env.LOCALAPPDATA, 'Temp/kilo/s2-classify');
const smoke = await readJsonl(new URL('../smoke.jsonl', import.meta.url));
const rubric = await readFile(new URL('../../../fixtures/synthetic/classify/RUBRIC.md', import.meta.url), 'utf8');
async function options(name, count = 3) {
  await mkdir(output, { recursive: true });
  return { items: smoke.slice(0,count), newIds: smoke.slice(0,2).map(row => row.id), rubric, directory: await mkdtemp(path.join(output, `${name}-`)) };
}
async function perform(store, type, values = {}) { return store.action({ type, revision: store.view().revision, ...values }); }
async function accept(store) { while (store.view().read < store.view().readTotal) await perform(store,'read-new'); await perform(store,'accept'); }
const choices = [{ category: 'political', risk: 0 }, { category: 'racist', risk: 2 }];

test('journal requires reading and acceptance, preserves human multi-labels across restart, skip, back and undo', async () => {
  const config = await options('store'); let store = await openLabelStore(config);
  try {
    await assert.rejects(perform(store,'accept'), /Read/);
    await assert.rejects(perform(store,'save',{ labels: choices, note:'' }), /Accept/);
    await assert.rejects(openLabelStore(config), /EEXIST/);
    await accept(store);
    await perform(store,'save',{ labels: choices, note:'test-only generated note' });
    const before = await readFile(path.join(config.directory,'labels.history.jsonl'),'utf8');
    await store.close(); store = await openLabelStore(config);
    assert.equal(store.view().progress,1); assert.equal(store.view().cursor,1);
    await perform(store,'skip'); assert.equal(store.view().cursor,2);
    await perform(store,'back'); assert.equal(store.view().cursor,1);
    await perform(store,'back'); assert.deepEqual(store.view().currentLabel.labels,choices);
    await perform(store,'save',{ labels: [{ category:'unclear',risk:1 }],note:'' });
    await perform(store,'undo'); assert.deepEqual(store.view().currentLabel.labels,choices);
    await perform(store,'undo'); assert.equal(store.view().progress,0);
    assert.ok((await readFile(path.join(config.directory,'labels.history.jsonl'),'utf8')).startsWith(before));
    const revision = store.view().revision;
    const settled = await Promise.allSettled([store.action({ type:'skip',revision }),store.action({ type:'skip',revision })]);
    assert.equal(settled.filter(value => value.status === 'fulfilled').length,1);
    await assert.rejects(perform(store,'finalize'), /cover every item/);
    await assert.rejects(perform(store,'save',{ labels:[{category:'harmless',risk:0},...choices], note:'' }), /nonexclusive/);
  } finally { await store.close(); }
  await assert.rejects(openLabelStore({ ...config, rubric: `${rubric}\nchanged` }), /DATA_CHANGED/);
  await assert.rejects(openLabelStore({ ...config, items: [...config.items].reverse() }), /DATA_CHANGED/);
  const file = path.join(config.directory,'labels.history.jsonl');
  const events = (await readFile(file,'utf8')).trim().split('\n').map(line => JSON.parse(line));
  events[0].identity.criteria[0].hash = `sha256:${'0'.repeat(64)}`;
  await writeFile(file, events.map(event => JSON.stringify(event)).join('\n')+'\n');
  await assert.rejects(openLabelStore(config), /DATA_CHANGED/);
});
test('finalization is exclusive, hash bound and refused after a partial write', async () => {
  const config = await options('finalize',2); const store = await openLabelStore(config);
  try {
    await accept(store);
    for (let i = 0; i < 2; i++) await perform(store,'save',{ labels: choices,note:'' });
    await perform(store,'finalize');
    const file = path.join(config.directory,'labels.jsonl'), bytes = await readFile(file,'utf8');
    const labels = validateLabels(config.items,await readJsonl(file));
    const manifest = JSON.parse(await readFile(path.join(config.directory,'labels.manifest.json'),'utf8'));
    assert.deepEqual(manifest.criteria, checkedCriteria);
    validateLabelSnapshot(manifest,labels,digest(JSON.stringify(config.items)),digest(bytes),digest(rubric));
    await assert.rejects(perform(store,'finalize'), /FINALIZED/);
    assert.equal(await readFile(file,'utf8'),bytes);
  } finally { await store.close(); }
  const partial = await options('partial');
  await writeFile(path.join(partial.directory,'labels.jsonl'), 'partial');
  const reopened = await openLabelStore(partial);
  try { assert.equal(reopened.view().finalized,true); await assert.rejects(perform(reopened,'read-new'), /FINALIZED/); }
  finally { await reopened.close(); }
  const collision = await options('manifest-collision',2), failed = await openLabelStore(collision);
  try {
    await accept(failed);
    for (let i = 0; i < 2; i++) await perform(failed,'save',{ labels:choices,note:'' });
    await writeFile(path.join(collision.directory,'labels.manifest.json'),'planted test-only collision');
    await assert.rejects(perform(failed,'finalize'), /EEXIST/);
    assert.equal(failed.view().finalized,true);
    await assert.rejects(perform(failed,'save',{labels:choices,note:''}), /FINALIZED/);
    assert.equal(await readFile(path.join(collision.directory,'labels.manifest.json'),'utf8'),'planted test-only collision');
  } finally { await failed.close(); }
});
test('Wilson and multi-label one-versus-rest arithmetic use a tiny generated set, not maintainer labels', () => {
  const interval = wilson(16,20); assert.ok(Math.abs(interval.lower-.584) < .002); assert.ok(Math.abs(interval.upper-.919) < .002);
  assert.equal(wilson(0,0),null); assert.throws(() => wilson(21,20));
  const items = smoke.slice(0,3), source = { kind:'model',name:'test-only',version:'1' }, at = '2026-10-06T17:00:00Z';
  const human = [choices,[{category:'racist',risk:3}],[{category:'harmless',risk:0}]];
  const predicted = [choices,[{category:'political',risk:1}],[{category:'harmless',risk:1}]];
  const labels = human.map((values,i) => ({ itemId:items[i].id,labels:values,note:'',labeledAt:at,labeler:'maintainer' }));
  const rows = predicted.map((values,i) => ({ itemId:items[i].id, assessments:values.map(value => ({...value,itemId:items[i].id,source,createdAt:at,
    assessmentId:`generated-${i}-${value.category}`,submissionId:null,
    reason:'Generated scoring probe',evidence:null,confidence:null})),invalid:false,nonVerbatim:false,latencyMs:i+1 }));
  const result = metrics({set:'eval',rows,criteria:checkedCriteria,criteriaHash},items,labels);
  assert.equal(result.perCategory.racist.recall,.5); assert.equal(result.perCategory.political.precision,.5);
  assert.equal(result.perCategory.racist.precision,1); assert.equal(result.exactCategorySetAgreement,2/3);
  assert.equal(result.riskAgreement,2/3); assert.equal(result.riskAgreementDenominator,3);
  assert.deepEqual(result.perCategory.racist.recallWilson95,wilson(1,2));
  assert.equal(result.perCategory.misogynistic.recall,null);
  assert.throws(() => metrics({set:'eval',rows:[rows[0],rows[0],rows[2]],criteria:checkedCriteria,criteriaHash},items,labels),/duplicate/);
  assert.throws(() => metrics({set:'eval',rows,criteria:[],criteriaHash},items,labels),/EVAL_LOCKED/);
  assert.throws(() => metrics({set:'eval',rows,criteria:checkedCriteria,criteriaHash:'changed'},items,labels),/EVAL_LOCKED/);
});

test('default spike tests cannot import a label server or browser; normal human files stay absent', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('.',import.meta.url))).filter(file => file.endsWith('.test.mjs'));
  for (const file of files) assert.doesNotMatch(await readFile(new URL(file,import.meta.url),'utf8'), /(?:from|import\s*\()\s*['"][^'"]*(?:label-server|playwright)/u);
  const scripts = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).scripts;
  assert.equal(scripts.test,'node --test --test-concurrency=1 test/*.test.mjs');
  assert.equal(scripts['test:browser'],'node --test --test-concurrency=1 test/label-browser.mjs');
  const server = await readFile(new URL('../label-server.mjs',import.meta.url),'utf8');
  assert.match(server,/rubric \?\?= \(await readRubric\(\)\)\.text/u);
  for (const file of ['labels.jsonl','labels.history.jsonl','labels.manifest.json']) await assert.rejects(access(new URL(`../local/${file}`,import.meta.url)),{code:'ENOENT'});
});
