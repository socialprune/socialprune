import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import path from 'node:path';
import { prompt, outputSchema, descriptions, contractVersion } from './contract.mjs';
import { tempRoot, installedChrome, bytes } from './machine.mjs';
import { webModels, nliModel } from './models.mjs';
import { buildIdentity } from './provenance.mjs';

async function bounded(promise, ms, phase) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser ${phase} timeout after ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function browserTier(tier, requestedModel, rubric = { text: '', categoryDescriptions: descriptions }) {
  const response = await fetch('http://127.0.0.1:4174/build-identity.json', { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok || (await response.json()).hash !== (await buildIdentity()).hash) throw new Error('Browser build is stale; run the spike build before inference');
  const model = requestedModel ?? (tier === 'webllm' ? 'Qwen3-0.6B-q4f16_1-MLC' : tier === 'mdeberta' ? nliModel.repository : 'Chrome-Gemini-Nano');
  if (tier === 'webllm' && !webModels[model]) throw new Error('Use a pinned Qwen3 0.6B or 1.7B WebLLM id');
  if (tier === 'mdeberta' && model !== nliModel.repository) throw new Error('Only the pinned multilingual NLI model is configured');
  const installed = tier === 'prompt-api' ? await installedChrome() : [];
  const directory = path.join(tempRoot, `profile-${tier}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const context = await chromium.launchPersistentContext(directory, { headless: tier === 'mdeberta',
    executablePath: installed[0]?.executable, args: tier === 'webllm' ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] : [],
    acceptDownloads: false });
  const identity = { requested: model, installedChrome: installed, browserVersion: context.browser()?.version() ?? 'persistent Chromium',
    profile: directory, profileBytes: null, cache: [], externalOrigins: [], cspViolations: [] };
  const external = new Set(), requests = [];
  context.on('request', request => { const url = new URL(request.url()); requests.push({ origin: url.origin, path: url.pathname });
    if (url.origin !== 'http://127.0.0.1:4174') external.add(url.origin); });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text().slice(0, 800)); });
  const close = async () => {
    try {
      await bounded(page.evaluate(() => window.s2Close?.()), 10000, 'unload');
      identity.cache = await bounded(page.evaluate(() => window.s2CacheSizes?.() ?? []), 120000, 'cache byte readback');
    }
    finally { identity.externalOrigins = [...external]; identity.requests = requests; await context.close(); identity.profileBytes = (await bytes(directory)).bytes; }
  };
  try {
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'load' });
    await page.waitForFunction(() => window.s2Ready, { timeout: 30000 });
    await page.evaluate(() => { window.s2Csp = []; document.addEventListener('securitypolicyviolation', event =>
      window.s2Csp.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI })); });
    const init = await bounded(page.evaluate(async ({ tier, model }) => window.s2Initialize(tier, model), { tier, model }), 600000, 'initialization');
    if (init.needsClick) { await page.click('#prompt-start'); Object.assign(identity, await bounded(page.evaluate(() => window.s2PromptReady), 600000, 'Nano download')); }
    else Object.assign(identity, init);
  } catch (error) {
    await close();
    console.error('BROWSER_BLOCKER', JSON.stringify(identity));
    error.identity = identity;
    throw error;
  }
  const source = { kind: 'model', name: `${tier}/${model}`, version: tier === 'webllm' ? webModels[model].revision : tier === 'mdeberta' ? nliModel.revision : identity.browserVersion };
  return { source, identity,
    async classify(item, createdAt) {
      const result = await bounded(page.evaluate(payload => window.s2Classify(payload), { item, source, createdAt,
        messages: prompt(item, source, createdAt, rubric.text), schema: outputSchema(item, source, createdAt),
        descriptions: rubric.categoryDescriptions, riskDescriptions: rubric.riskDescriptions, contractVersion }), 180000, 'item inference');
      identity.cspViolations = await page.evaluate(() => window.s2Csp);
      return result;
    }, close };
}
