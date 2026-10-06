import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:4173';
const temp = path.join(process.env.LOCALAPPDATA, 'Temp/kilo/phase1-foundation/s3');
const runID = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(temp, `trial-${runID}.json`);
const profiles = [];
const report = { date: new Date().toISOString(), runs: [], profiles, browser: null,
  flags: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  source: {} };
for (const name of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'index.html', 'vite.config.js', 'src/main.js', 'src/worker.js', 'policies.js']) {
  report.source[name] = createHash('sha256').update(await readFile(name)).digest('hex');
}
await mkdir(temp, { recursive: true });
const only = process.argv.find(arg => arg.startsWith('--runtime='))?.split('=')[1];
const existingProfile = process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length);
const headedOnly = process.argv.includes('--headed');
let context;
let current;
let page;

async function bytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await bytes(file) : (await stat(file)).size;
  }
  return total;
}

async function launch(headless) {
  const profile = existingProfile || path.join(temp, `profile-${headless ? 'headless' : 'headed'}-${runID}`);
  if (!path.resolve(profile).startsWith(path.resolve(temp) + path.sep)) throw new Error('Profile must be inside the S3 temp directory');
  profiles.push({ path: profile, headless });
  context = await chromium.launchPersistentContext(profile, {
    headless, args: report.flags, serviceWorkers: 'allow',
  });
  report.browser = context.browser()?.version();
  context.on('request', request => current?.contextRequests.push({ url: request.url(), type: request.resourceType(),
    serviceWorker: Boolean(request.serviceWorker()) }));
  context.on('requestfailed', request => current?.contextFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  context.on('requestfinished', async request => {
    const row = current;
    if (!row) return;
    try {
      row.finished.push({ url: request.url(), method: request.method(),
        timing: request.timing(), sizes: await request.sizes() });
    } catch (error) { row.measurementErrors.push(String(error)); }
  });
  context.on('response', response => {
    if (current) current.responses.push({ url: response.url(), status: response.status(),
      fromServiceWorker: response.fromServiceWorker(), headers: response.headers() });
  });
  await context.exposeBinding('s3report', (_, event) => {
    current?.events.push(event);
    if (event.kind === 'progress' && (event.progress === 1 || event.progress % 0.2 < 0.01)) {
      console.log('PROGRESS', event.text);
    }
  });
  page = context.pages()[0];
  page.on('request', request => current?.pageRequests.push({ url: request.url(), type: request.resourceType() }));
  page.on('requestfailed', request => current?.pageFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('pageerror', error => current?.errors.push(String(error)));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) current?.console.push({ type: message.type(), text: message.text() });
  });
  await page.goto(base);
  await page.evaluate(() => globalThis.s3.ready);
  await page.reload();
  await page.evaluate(() => globalThis.s3.ready);
}

async function close() {
  await context.close();
  context = null;
  profiles.at(-1).bytesAfterClose = await bytes(profiles.at(-1).path);
}

async function run(runtime, variant, offline, mode) {
  current = { runtime, variant, offline, mode, pageRequests: [], pageFailures: [], contextRequests: [],
    contextFailures: [], responses: [], finished: [], measurementErrors: [], events: [], errors: [], console: [] };
  report.runs.push(current);
  await context.setOffline(offline);
  if (offline) {
    const reload = await page.reload();
    await page.evaluate(() => globalThis.s3.ready);
    current.offlineReloadFromServiceWorker = reload.fromServiceWorker();
  }
  const begin = performance.now();
  const response = await page.goto(`${base}/${variant}.html`);
  await page.evaluate(() => globalThis.s3.ready);
  current.documentFromServiceWorker = response.fromServiceWorker();
  current.documentCSP = response.headers()['content-security-policy'];
  current.result = await page.evaluate(({ runtime, mode }) => globalThis.s3.run(runtime, mode), { runtime, mode });
  current.wallMs = performance.now() - begin;
  current.externalOrigins = [...new Set(current.contextRequests.map(row => new URL(row.url).origin).filter(origin => origin !== base && origin !== 'null'))];
  current.workerResponses = current.responses.filter(row => row.url.includes('/assets/worker-'));
  current.fetchRequests = current.contextRequests.filter(row => row.type === 'fetch' || row.type === 'xhr');
  current.inventory = await page.evaluate(() => globalThis.s3.inventory());
  current.storage = await page.evaluate(() => navigator.storage.estimate());
  const summary = { ...current.result };
  delete summary.stack;
  delete summary.gpu;
  if (summary.outputs) summary.outputs = summary.outputs.map(({ input, output, ms }) => ({ input, output, ms }));
  console.log('ROW', JSON.stringify({ runtime, variant, offline, mode, result: summary,
    requests: current.contextRequests.length, origins: current.externalOrigins,
    csp: current.events.filter(e => e.kind === 'csp'), cacheBytes: current.inventory.reduce((n, r) => n + r.bytes, 0) }));
  await writeFile(output, JSON.stringify(report, null, 2));
  return current.result;
}

try {
  await launch(!headedOnly);
  console.log('BROWSER', report.browser, 'PROFILE', profiles.at(-1).path);
  if (!only || only === 'transformers') {
    await run('transformers', 'V3', false, 'stock');
    const baseline = await run('transformers', 'V3', false, 'cache-bytes');
    if (!baseline.ok) throw new Error(`Transformers online foundation failed: ${baseline.error}`);
    for (const offline of [false, true]) {
      for (const variant of ['V1', 'V2', 'V3']) {
        await run('transformers', variant, offline, 'stock');
        await run('transformers', variant, offline, 'cache-bytes');
      }
    }
    await run('transformers', 'V1', true, 'cache-metadata');
    await run('transformers', 'V4', true, 'cache-metadata');
    await run('transformers', 'V5', true, 'cache-bytes');
    current = { runtime: 'browser-probe', variant: 'V1', offline: true, events: [],
      contextRequests: [], pageRequests: [], pageFailures: [], contextFailures: [], responses: [], finished: [], measurementErrors: [], errors: [], console: [] };
    report.runs.push(current);
    await page.goto(`${base}/V1.html`);
    await page.evaluate(() => globalThis.s3.ready);
    current.result = await page.evaluate(() => globalThis.s3.probe());
    console.log('PROBE', JSON.stringify(current.result));
  }
  if (!only || only === 'webllm') {
    const gpu = await run('gpu', 'V3', false, 'stock');
    if (!gpu.gpu.available && !headedOnly) {
      await close();
      await launch(false);
      await run('gpu', 'V3', false, 'stock');
    }
    let baseline = await run('webllm', 'V3', false, 'stock');
    if (!baseline.ok && !headedOnly && profiles.at(-1).headless) {
      report.webllmHeadlessBlocker = baseline.error;
      await close();
      await launch(false);
      baseline = await run('webllm', 'V3', false, 'stock');
    }
    if (baseline.ok) {
      await run('webllm', 'V3', false, 'cache-lib');
      for (const offline of [false, true]) {
        for (const variant of ['V1', 'V2', 'V3']) {
          await run('webllm', variant, offline, 'stock');
          await run('webllm', variant, offline, 'cache-lib');
        }
      }
      await run('webllm', 'V5', true, 'cache-lib');
    } else {
      report.webllmBlocker = baseline.error;
      for (const variant of ['V1', 'V2', 'V3']) await run('webllm', variant, true, 'stock');
      await run('webllm', 'V1', true, 'cache-lib');
    }
  }
} catch (error) {
  report.harnessError = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (context) await close();
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log('RESULT_FILE', output);
  console.log('MACHINE_READBACK', JSON.stringify(profiles));
}
