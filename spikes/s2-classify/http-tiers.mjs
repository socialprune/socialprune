import { readFile } from 'node:fs/promises';
import { prompt, outputSchema } from './contract.mjs';

const ollamaURL = 'http://127.0.0.1:11434';
export function assertLocalModel(model, show) {
  if (/cloud/i.test(model)) throw new Error('OLLAMA_REMOTE_REFUSED: cloud model name');
  const visit = object => {
    if (!object || typeof object !== 'object') return;
    for (const [key, value] of Object.entries(object)) {
      if (/remote[_-]?(host|model)|cloud[_-]?(host|model)/i.test(key) && value) throw new Error('OLLAMA_REMOTE_REFUSED: /api/show remote identity');
      if (typeof value === 'object') visit(value);
    }
  };
  visit(show);
  const from = show.modelfile?.split(/\r?\n/).find(line => /^FROM\s/i.test(line));
  if (from && /https?:\/\//i.test(from)) throw new Error('OLLAMA_REMOTE_REFUSED: remote FROM host');
  if (show.details?.format !== 'gguf' || !show.model_info || !from) throw new Error('OLLAMA_LOCAL_UNPROVEN: expected local GGUF details and model file');
}
async function jsonRequest(url, body, headers = {}, transport = fetch) {
  const response = await transport(url, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000) });
  if (!response.ok) {
    // Record causal endpoint errors, but never echo authorization material or request bodies.
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Local endpoint HTTP ${response.status}: ${String(detail.error ?? 'no detail').slice(0, 500)}`);
  }
  return response.json();
}
export async function ollamaTier(model, transport = fetch, rubricText = '') {
  if (!model) throw new Error('Ollama requires --model <local tag>');
  if (/cloud/i.test(model)) throw new Error('OLLAMA_REMOTE_REFUSED: cloud model name');
  const show = await jsonRequest(`${ollamaURL}/api/show`, { model }, {}, transport);
  assertLocalModel(model, show);
  const tags = await jsonRequest(`${ollamaURL}/api/tags`, null, {}, transport);
  const canonical = model.includes(':') ? model : `${model}:latest`;
  const record = tags.models?.find(row => row.name === canonical);
  if (!record) throw new Error('Model must already be present in the local model list');
  const source = { kind: 'model', name: `ollama/${canonical}`, version: record.digest };
  const answered = new Set();
  return { source, identity: { requested: model, canonical, digest: record.digest, size: record.size,
    details: record.details, remoteHost: null, answered: [], runtime: (await jsonRequest(`${ollamaURL}/api/version`, null, {}, transport)).version },
    async classify(item, createdAt) {
      const response = await jsonRequest(`${ollamaURL}/api/chat`, { model: canonical, stream: false, think: false,
        keep_alive: '5m', messages: prompt(item, source, createdAt, rubricText), format: outputSchema(item, source, createdAt),
        options: { temperature: 0, seed: 42, num_predict: 512, num_ctx: 4096 } }, {}, transport);
      if (response.model !== canonical || response.remote_host || response.remote_model) throw new Error('OLLAMA_ANSWER_IDENTITY_MISMATCH');
      answered.add(response.model); this.identity.answered = [...answered];
      return { raw: response.message?.content, usage: { totalDurationNs: response.total_duration,
        loadDurationNs: response.load_duration, promptTokens: response.prompt_eval_count, outputTokens: response.eval_count }, transportOk: true };
    }, async close() {
      await jsonRequest(`${ollamaURL}/api/generate`, { model: canonical, keep_alive: 0 }, {}, transport);
      this.identity.unloadRequested = true;
    } };
}
export async function referenceTier(model, keyFile, rubricText = '') {
  if (!keyFile) throw new Error('REFERENCE_LOCKED: explicit --key-file is required; no key is read from the environment or config');
  if (!model) throw new Error('Reference requires the maintainer-selected --model');
  const key = (await readFile(keyFile, 'utf8')).trim();
  if (!key || /[\r\n]/.test(key)) throw new Error('Key file must contain one nonempty key');
  const source = { kind: 'model', name: `ccs/${model}`, version: null };
  const headers = { Authorization: `Bearer ${key}` };
  return { source, identity: { requested: model, answered: [], endpoint: 'http://127.0.0.1:8317/v1', keySource: 'explicit file' },
    async classify(item, createdAt) {
      const response = await jsonRequest('http://127.0.0.1:8317/v1/chat/completions', { model,
        messages: prompt(item, source, createdAt, rubricText), temperature: 0, max_tokens: 512,
        response_format: { type: 'json_schema', json_schema: { name: 'assessment', strict: true, schema: outputSchema(item, source, createdAt) } } }, headers);
      if (typeof response.model !== 'string' || !response.model) throw new Error('Reference did not record its answering model');
      this.identity.answered = [...new Set([...this.identity.answered, response.model])];
      return { raw: response.choices?.[0]?.message?.content, usage: response.usage, answeredModel: response.model, transportOk: true };
    }, async close() {} };
}
