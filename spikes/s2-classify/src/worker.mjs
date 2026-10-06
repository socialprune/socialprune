import { env, pipeline } from '@huggingface/transformers';
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { webModels, nliModel } from '../models.mjs';

let engine, classifier, tier;
async function initialize(selectedTier, model) {
  tier = selectedTier;
  if (tier === 'webllm') {
    const record = webModels[model];
    if (!record) throw new Error('Unsupported pinned WebLLM model');
    const prebuilt = prebuiltAppConfig.model_list.find(row => row.model_id === model);
    if (!prebuilt) throw new Error('WebLLM prebuilt model record is missing');
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const url = new URL(`/mlc/${record.library}`, self.location).href;
    // S3 artifact-cache loading path, using 127.0.0.1 rather than the localhost spelling.
    const wasm = await fetch(url);
    if (!wasm.ok) throw new Error('Self-hosted model library is missing');
    await (await caches.open('webllm/wasm')).put(url, wasm);
    engine = await CreateMLCEngine(model, { appConfig: { cacheBackend: 'cache', model_list: [{ ...prebuilt,
      model: `https://huggingface.co/${record.repository}/resolve/${record.revision}/`, model_lib: url,
      overrides: { context_window_size: 4096 } }] },
      initProgressCallback: progress => self.postMessage({ progress: progress.text }) });
    return { ...record, model, runtime: 'webllm@0.2.85', gpu: { vendor: adapter.info.vendor,
      architecture: adapter.info.architecture, features: [...adapter.features] } };
  }
  if (tier !== 'mdeberta' || model !== nliModel.repository) throw new Error('Unsupported pinned NLI model');
  env.allowLocalModels = false; env.useBrowserCache = true;
  env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
  env.useWasmCache = false;
  const wasmURL = new URL('/ort/ort-wasm-simd-threaded.asyncify.wasm', self.location).href;
  const wasm = await fetch(wasmURL);
  if (!wasm.ok) throw new Error('Self-hosted ONNX WASM missing');
  env.backends.onnx.wasm.wasmBinary = await wasm.arrayBuffer();
  env.backends.onnx.wasm.wasmPaths = { mjs: new URL('/ort/ort-wasm-simd-threaded.asyncify.mjs', self.location).href, wasm: wasmURL };
  const networkFetch = env.fetch;
  env.fetch = async (input, init) => {
    const url = new URL(input, self.location);
    if (url.hostname === 'huggingface.co') {
      if (!url.pathname.startsWith(`/${nliModel.repository}/resolve/`)) throw new Error('Unexpected model download');
      url.pathname = url.pathname.replace('/resolve/main/', `/resolve/${nliModel.revision}/`);
    }
    const cached = await caches.match(url.href);
    return cached ?? networkFetch(url.href, init);
  };
  classifier = await pipeline('zero-shot-classification', model, { revision: nliModel.revision, dtype: 'q8', device: 'wasm' });
  return { ...nliModel, runtime: 'transformers.js@4.3.0', adapter: 'category NLI + independent risk NLI, no text generation' };
}
async function classify(payload) {
  if (tier === 'webllm') {
    await engine.resetChat();
    const response = await engine.chat.completions.create({ messages: payload.messages, temperature: 0,
      seed: 42, max_tokens: 512, extra_body: { enable_thinking: false },
      response_format: { type: 'json_object', schema: JSON.stringify(payload.schema) } });
    return { raw: response.choices[0].message.content, usage: response.usage, transportOk: true };
  }
  const descriptions = Object.values(payload.descriptions), categories = Object.keys(payload.descriptions);
  const answer = await classifier(payload.item.text, descriptions, { hypothesis_template: 'This social post contains {}.', multi_label: false });
  const index = descriptions.indexOf(answer.labels[0]);
  if (index < 0) throw new Error('NLI returned an unknown label');
  const riskLabels = payload.riskDescriptions;
  const risk = await classifier(payload.item.text, riskLabels, { hypothesis_template: 'For account tidying before a job application this post presents {}.', multi_label: false });
  const category = categories[index];
  return { raw: { itemId: payload.item.id, source: payload.source, category, risk: riskLabels.indexOf(risk.labels[0]),
    reason: `The NLI adapter selected ${category} from the shared category definitions`, evidence: null,
    confidence: answer.scores[0], createdAt: payload.createdAt }, transportOk: true,
    usage: { categoryScores: answer, riskScores: risk, policyContract: payload.contractVersion } };
}
self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.operation === 'initialize') result = await initialize(data.tier, data.model);
    else if (data.operation === 'classify') result = await classify(data);
    else if (data.operation === 'close') { if (engine) await engine.unload(); if (classifier) await classifier.dispose(); result = { closed: true }; }
    else throw new Error('Unknown worker operation');
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: String(error.message) }); }
};
