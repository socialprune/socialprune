// Explicit opt-in only: starts disposable label servers and a test-owned Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { chromium } from 'playwright';
import { createLabelServer } from '../label-server.mjs';
import { readJsonl } from '../contract.mjs';
import { loadDataset } from '../dataset.mjs';

const output = process.env.SP_S2_PROOF_DIR ?? path.join(process.env.LOCALAPPDATA, 'Temp/kilo/s2-classify-browser');
const smoke = await readJsonl(new URL('../smoke.jsonl', import.meta.url));
const rubric = await readFile(new URL('../../../fixtures/synthetic/classify/RUBRIC.md', import.meta.url), 'utf8');
async function options(name, count = 3) {
  await mkdir(output, { recursive: true });
  return { items: smoke.slice(0,count), newIds: smoke.slice(0,2).map(row => row.id), rubric, directory: await mkdtemp(path.join(output, `${name}-`)) };
}
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
    const secondConfig = await options('foreign'); const second = await createLabelServer({port:4763,dataset:secondConfig,rubric,directory:secondConfig.directory});
    try { const foreign = await context.newPage(); await foreign.goto(second.origin); assert.throws(() => sameOrigin(requests),assert.AssertionError); }
    finally { await second.close(); }
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
    // This disposable reading journal contains no expected classifications.
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
    await writeFile(path.join(output,'screenshot-requests.json'),JSON.stringify(seen,null,2));
  } finally { await context.close();await browser.close();await app.close(); }
  for (const file of ['labels.jsonl','labels.history.jsonl','labels.manifest.json']) await assert.rejects(access(new URL(`../local/${file}`,import.meta.url)),{code:'ENOENT'});
});
