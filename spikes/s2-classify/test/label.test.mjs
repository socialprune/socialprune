import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { chromium } from 'playwright';
import { createLabelServer } from '../label-server.mjs';
import { openLabelStore } from '../label-store.mjs';
import { readJsonl, validateLabels, validateLabelSnapshot, digest } from '../contract.mjs';
import { loadDataset } from '../dataset.mjs';
import { metrics, wilson } from '../metrics.mjs';

const output = process.env.SP_S2_PROOF_DIR ?? path.join(process.env.LOCALAPPDATA, 'Temp/kilo/phase2/s1');
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
  const result = metrics({set:'eval',rows},items,labels);
  assert.equal(result.perCategory.racist.recall,.5); assert.equal(result.perCategory.political.precision,.5);
  assert.equal(result.perCategory.racist.precision,1); assert.equal(result.exactCategorySetAgreement,2/3);
  assert.equal(result.riskAgreement,2/3); assert.equal(result.riskAgreementDenominator,3);
  assert.deepEqual(result.perCategory.racist.recallWilson95,wilson(1,2));
  assert.equal(result.perCategory.misogynistic.recall,null);
  assert.throws(() => metrics({set:'eval',rows:[rows[0],rows[0],rows[2]]},items,labels),/duplicate/);
});

test('real loopback page records every request, rejects hostile callers and resumes after browser and server close', { timeout:120000 }, async () => {
  const config = await options('page',3); let app = await createLabelServer({ port:4761,dataset:config,rubric,directory:config.directory });
  const requests = []; const browser = await chromium.launch({ headless:true });
  let context = await browser.newContext({ viewport:{width:1280,height:1100},colorScheme:'light' });
  const record = request => requests.push({url:request.url(),method:request.method(),type:request.resourceType()});
  context.on('request',record);
  const sameOrigin = records => { for (const request of records) assert.equal(new URL(request.url).origin,app.origin); };
  try {
    const page = await context.newPage(); const failures = []; page.on('pageerror',error => failures.push(error.message));
    await page.goto(app.origin); await page.getByRole('button',{name:'Gelesen, nächster Eintrag →'}).click();
    assert.equal(await page.locator('#controls').isVisible(),false);
    assert.equal(await page.locator('#notice').textContent(),'');
    await page.getByRole('button',{name:'Gelesen, nächster Eintrag →'}).click();
    await page.locator('#accept').click();
    await page.locator('[data-category="political"]').click(); await page.locator('[data-risk="0"]').click();
    await page.locator('[data-category="racist"]').click(); await page.locator('[data-risk="2"]').click();
    assert.equal(await page.locator('[aria-pressed="true"][data-category]').count(),2);
    await page.locator('#save').click(); await page.locator('#progress').filter({hasText:'1 von 3'}).waitFor();
    await page.locator('#skip').click(); await page.locator('#back').click();
    await page.locator('#undo').click(); await page.locator('#progress').filter({hasText:'0 von 3'}).waitFor();
    await page.locator('[data-category="harmless"]').click(); await page.locator('[data-risk="0"]').click();
    await page.locator('#save').click(); await page.locator('#progress').filter({hasText:'1 von 3'}).waitFor();
    await context.close(); await app.close();
    app = await createLabelServer({ port:4761,dataset:config,rubric,directory:config.directory });
    context = await browser.newContext({ viewport:{width:1280,height:1100} }); context.on('request',record);
    const resumed = await context.newPage(); await resumed.goto(app.origin);
    await resumed.locator('#progress').filter({hasText:'1 von 3'}).waitFor();
    assert.equal(await resumed.locator('[aria-pressed="true"][data-category]').count(),0);
    // Category keys stay categories before and after risk entry; digits never select one.
    assert.deepEqual(await resumed.locator('#categories kbd').allTextContents(),['Q','W','E','R','T','Y','I','O','H','?','A','S','D','F']);
    assert.match(await resumed.locator('#help').textContent(),/Ziffern 0 bis 3 setzen nur das Risiko/);
    await resumed.locator('#title').click(); await resumed.keyboard.press('0');
    assert.equal(await resumed.locator('[aria-pressed="true"][data-category]').count(),0);
    await resumed.keyboard.press('q'); await resumed.keyboard.press('w');
    assert.equal(await resumed.locator('[aria-pressed="true"][data-category]').count(),2);
    assert.equal(await resumed.locator('[data-category="toxic"] .badge').textContent(),'?');
    assert.equal(await resumed.locator('[data-category="personal-attack"] .badge').textContent(),'?');
    await resumed.keyboard.press('2'); await resumed.keyboard.press('3');
    assert.equal(await resumed.locator('[data-category="personal-attack"] .badge').textContent(),'3');
    assert.equal(await resumed.locator('[data-category="political"]').getAttribute('aria-pressed'),'false');
    assert.equal(await resumed.locator('#risk-title').textContent(),'Risiko für Persönlicher Angriff wählen: 0 bis 3');
    await resumed.keyboard.press('w'); await resumed.keyboard.press('q');
    await resumed.keyboard.press('a'); await resumed.keyboard.press('2');
    await resumed.keyboard.press('e'); await resumed.keyboard.press('0');
    assert.equal(await resumed.locator('[aria-pressed="true"][data-category]').count(),2);
    await resumed.keyboard.press('Enter'); await resumed.locator('#progress').filter({hasText:'2 von 3'}).waitFor();
    const savedKeys = (await readJsonl(path.join(config.directory,'labels.history.jsonl'))).filter(row => row.event === 'save').at(-1).label.labels;
    assert.deepEqual(savedKeys,[{category:'racist',risk:2},{category:'political',risk:0}]);
    await resumed.locator('[data-category="misogynistic"]').click();
    await resumed.keyboard.press('1'); await resumed.keyboard.press('Enter');
    await resumed.locator('#progress').filter({hasText:'3 von 3'}).waitFor();
    const before = await readFile(path.join(config.directory,'labels.history.jsonl'),'utf8');
    const response = await fetch(`${app.origin}/api/state`); const metadata = await response.json();
    assert.equal(metadata.categories.length,14); assert.equal('design' in metadata,false); assert.equal('focus' in metadata,false);
    assert.equal((await fetch(`${app.origin}/api/state`,{headers:{Origin:'http://127.0.0.1:4763'}})).status,403);
    const hostileHost = await new Promise((resolve,reject) => { const req = request(`${app.origin}/api/state`,{headers:{Host:'localhost:4761'}},res => {res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(); });
    assert.equal(hostileHost,403);
    assert.equal((await fetch(`${app.origin}/api/action`,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(`${app.origin}/../contract.mjs`)).status,404);
    assert.equal((await fetch(`${app.origin}/api/action`,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-S2-Token':metadata.token},body:JSON.stringify({type:'skip',revision:0})})).status,409);
    assert.equal(await readFile(path.join(config.directory,'labels.history.jsonl'),'utf8'),before);
    sameOrigin(requests); assert.ok(requests.some(row => row.method === 'POST')); assert.deepEqual(failures,[]);
    console.log('PAGE_AUDIT same-origin lifecycle and hostile callers passed');
    // Positive control: an actual second loopback origin is observed, not a fetch stub.
    const secondConfig = await options('foreign'); const second = await createLabelServer({port:4763,dataset:secondConfig,rubric,directory:secondConfig.directory});
    try { const foreign = await context.newPage(); await foreign.goto(second.origin); assert.throws(() => sameOrigin(requests),assert.AssertionError); }
    finally { await second.close(); }
    console.log('PAGE_AUDIT second-origin positive control passed');
    await writeFile(path.join(output,'page-requests.json'),JSON.stringify(requests,null,2));
  } finally { await context.close(); await browser.close(); await app.close(); }
});

test('screenshots show the real 560-item reading pass and empty labelling controls in both languages and themes', {timeout:120000}, async () => {
  const dataset = await loadDataset(), config = await options('screens');
  const app = await createLabelServer({port:4762,dataset,rubric,directory:config.directory});
  const browser = await chromium.launch({headless:true}); const context = await browser.newContext({viewport:{width:1280,height:1200}});
  const seen = []; context.on('request',request => seen.push(request.url()));
  try {
    const page = await context.newPage(); await page.goto(app.origin);
    await page.locator('#text').filter({hasText:dataset.items.find(item => item.id === dataset.newIds[0]).text}).waitFor();
    const screens = path.join(output,'screens','revision'); await mkdir(screens,{recursive:true});
    await page.screenshot({path:path.join(screens,'s2-new-reading-de-light.png'),fullPage:true});
    const metadata = await (await fetch(`${app.origin}/api/state`)).json();
    // This test-local reading journal contains no classifications and is never the maintainer file.
    let state = metadata;
    while (state.read < state.readTotal) state = await app.store.action({type:'read-new',revision:state.revision});
    await app.store.action({type:'accept',revision:state.revision});
    await page.reload(); await page.locator('#controls').waitFor();
    const captures = [['de','light',1280],['de','dark',1280],['de','dark',390],['en','light',1280],['en','dark',1280],['en','dark',390]];
    for (const [language,theme,width] of captures) {
      await page.evaluate(({language,theme}) => { localStorage.setItem('s2-language',language);localStorage.setItem('s2-theme',theme); },{language,theme});
      await page.setViewportSize({width,height:1200}); await page.reload(); await page.locator('#controls').waitFor();
      assert.equal(await page.locator('[aria-pressed="true"][data-category]').count(),0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:path.join(screens,`s2-label-${language}-${theme}-${width}.png`),fullPage:true});
      if (language === 'de' && (theme === 'light' || width === 390)) {
        await page.locator('[data-category="political"]').click();
        assert.equal(await page.locator('#risk-title').textContent(),'Risiko für Politisch wählen: 0 bis 3');
        await page.screenshot({path:path.join(screens,`s2-risk-${language}-${theme}-${width}.png`),fullPage:true});
      }
    }
    for (const url of seen) assert.equal(new URL(url).origin,app.origin);
    await writeFile(path.join(output,'revision-screenshot-requests.json'),JSON.stringify(seen,null,2));
  } finally { await context.close();await browser.close();await app.close(); }
  for (const file of ['labels.jsonl','labels.history.jsonl','labels.manifest.json']) await assert.rejects(access(new URL(`../local/${file}`,import.meta.url)),{code:'ENOENT'});
});
