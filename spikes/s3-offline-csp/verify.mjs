import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { policy } from './policies.js';

const file = process.argv[2];
assert(file, 'Pass the result JSON path printed by the trial');
const report = JSON.parse(await readFile(file, 'utf8'));
const quiet = process.argv.includes('--quiet');
assert(!report.harnessError, report.harnessError);
for (const [name, hash] of Object.entries(report.source)) {
  assert.equal(createHash('sha256').update(await readFile(name)).digest('hex'), hash, `Source changed: ${name}`);
}
for (const runtime of ['transformers', 'webllm']) {
  const mode = runtime === 'transformers' ? 'cache-bytes' : 'cache-lib';
  for (const variant of ['V1', 'V2', 'V3']) {
    for (const offline of [false, true]) {
      const row = report.runs.find(row => row.runtime === runtime && row.mode === mode && row.variant === variant && row.offline === offline);
      assert(row, `Missing ${runtime}/${mode}/${variant}/${offline}`);
      assert.equal(row.result.ok, true, row.result.error);
      assert.equal(row.result.outputs.length, 3);
      assert(row.result.outputs.every(output => output.output && output.ms > 0));
      assert.equal(row.documentCSP, policy(variant));
      assert(row.workerResponses.length > 0, 'Worker response not observed');
      assert(row.workerResponses.every(response => response.headers['content-security-policy'] === policy(variant)));
      assert.equal(row.documentFromServiceWorker, true);
      assert(row.workerResponses.every(response => response.fromServiceWorker));
      if (offline) assert.equal(row.offlineReloadFromServiceWorker, true);
      assert.equal(row.externalOrigins.length, 0);
      assert.equal(row.events.filter(event => event.kind === 'csp').length, 0);
      assert.equal(row.fetchRequests.length, 0);
    }
  }
  const denied = report.runs.find(row => row.runtime === runtime && row.mode === 'stock' && row.variant === 'V1' && row.offline);
  assert.equal(denied.result.ok, false);
  assert(denied.events.some(event => event.kind === 'csp' && event.effectiveDirective === 'connect-src'));
  const noWasm = report.runs.find(row => row.runtime === runtime && row.variant === 'V5');
  assert.equal(noWasm.result.ok, false);
  assert(noWasm.events.some(event => event.kind === 'csp' && event.blockedURI === 'wasm-eval'));
  for (const variant of ['V2', 'V3']) {
    const stock = report.runs.find(row => row.runtime === runtime && row.mode === 'stock' && row.variant === variant && row.offline);
    assert.equal(stock.result.ok, runtime === 'webllm', `Stock ${runtime}/${variant} outcome changed`);
  }
}
const stockOffline = report.runs.find(row => row.runtime === 'transformers' && row.mode === 'stock' && row.variant === 'V3' && row.offline);
assert(stockOffline.contextFailures.some(failure => failure.error === 'net::ERR_INTERNET_DISCONNECTED'));
const probe = report.runs.find(row => row.runtime === 'browser-probe');
assert.equal(probe.result.fetched.ok, false);
assert.equal(probe.result.cacheBytes, 26861777);
assert.equal(probe.result.serviceWorkerFetchesBefore, probe.result.serviceWorkerFetchesAfter);
assert(probe.events.some(event => event.effectiveDirective === 'connect-src'));
assert(report.runs.some(row => row.runtime === 'transformers' && row.variant === 'V4' && row.result.ok));

function summary(row) {
  return { runtime: row.runtime, variant: row.variant, offline: row.offline, mode: row.mode,
    ok: row.result.ok, error: row.result.error, loadMs: row.result.loadMs, inferenceMs: row.result.inferenceMs,
    totalMs: row.result.totalMs, requests: row.contextRequests.length,
    fetches: row.fetchRequests?.map(request => new URL(request.url).origin + new URL(request.url).pathname), externalOrigins: row.externalOrigins,
    violations: row.events.filter(event => event.kind === 'csp').map(event => ({ source: event.source, directive: event.effectiveDirective, blocked: event.blockedURI })) };
}
if (!quiet) for (const row of report.runs.filter(row => !['gpu', 'browser-probe'].includes(row.runtime))) console.log('MATRIX', JSON.stringify(summary(row)));
for (const runtime of ['transformers', 'webllm']) {
  const row = report.runs.find(row => row.runtime === runtime && !row.offline && row.inventory.some(item => item.url.includes(runtime === 'transformers' ? 'model_quantized.onnx' : 'params_shard_8.bin')));
  const model = row.inventory.filter(item => item.url.startsWith('https://huggingface.co') && item.url.includes(runtime === 'transformers' ? '/Xenova/' : '/mlc-ai/'));
  assert.equal(model.reduce((n, item) => n + item.bytes, 0), runtime === 'transformers' ? 68294435 : 346926408);
  assert.deepEqual(row.externalOrigins.sort(), ['https://huggingface.co', 'https://us.aws.cdn.hf.co']);
  const finished = row.finished.filter(item => item.url.startsWith('https://'));
  const windows = finished.map(item => ({ begin: item.timing.startTime, end: item.timing.startTime + item.timing.responseEnd }));
  console.log('DOWNLOAD', JSON.stringify({ runtime, artifacts: quiet ? undefined : model.map(item => ({ name: new URL(item.url).pathname.split('/').at(-1), bytes: item.bytes })), artifactBytes: model.reduce((n, r) => n + r.bytes, 0),
    responseBodyBytes: finished.reduce((n, r) => n + r.sizes.responseBodySize, 0),
    wallMs: row.wallMs, totalMs: row.result.totalMs,
    externalRequestSpanMs: Math.max(...windows.map(window => window.end)) - Math.min(...windows.map(window => window.begin)),
    requestTimings: quiet ? undefined : finished.filter(item => item.url.startsWith('https://us.aws.cdn.hf.co')).map(item => ({ artifact: row.responses.find(response => response.url === item.url)?.headers['content-disposition'], durationMs: item.timing.responseEnd, bodyBytes: item.sizes.responseBodySize })) }));
}
async function size(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await size(file) : (await stat(file)).size;
  }
  return bytes;
}
for (const profile of report.profiles) {
  console.log('PROFILE_READBACK', JSON.stringify({ ...profile, bytesNow: await size(profile.path) }));
}
const temp = path.join(process.env.LOCALAPPDATA, 'Temp/kilo/phase1-foundation/s3');
for (const name of await readdir(temp)) {
  if (name.startsWith('profile-')) console.log('ALL_PROFILE_READBACK', JSON.stringify({ name, bytes: await size(path.join(temp, name)) }));
}
console.log('BROWSER_CACHE', JSON.stringify({ bytes: await size(path.join(process.env.LOCALAPPDATA, 'ms-playwright')),
  directories: await readdir(path.join(process.env.LOCALAPPDATA, 'ms-playwright')) }));
const record = await readFile('../../docs/spikes/S3.md', 'utf8');
assert(!/[\u2013\u2014]|\b(safe|undetectable|bypass|guaranteed)\b/i.test(record));
for (const runtime of ['transformers', 'webllm']) {
  const mode = runtime === 'transformers' ? 'cache-bytes' : 'cache-lib';
  for (const variant of ['V1', 'V2', 'V3']) {
    const row = report.runs.find(row => row.runtime === runtime && row.mode === mode && row.variant === variant && row.offline);
    for (const field of ['loadMs', 'inferenceMs']) {
      assert(record.includes(row.result[field].toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), `Missing measured ${runtime}/${variant}/${field}`);
    }
  }
}
console.log('RECORD_PASS no prohibited prose markers; six offline timing pairs match trace');
console.log('VERIFY_PASS source hashes, 12 cached matrix rows, page/worker CSP, offline SW reloads, no fetch/external attempts, negative CSP branches, profile readback');
