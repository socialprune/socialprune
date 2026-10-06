import { env, pipeline } from '@huggingface/transformers';
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

const MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const REVISION = '0b6928efcb76139cae2c6881d49cda67fe119f42';
const QWEN = 'Qwen3-0.6B-q4f16_1-MLC';
const WASM = '/ort/ort-wasm-simd-threaded.asyncify.wasm';
const FACTORY = '/ort/ort-wasm-simd-threaded.asyncify.mjs';

self.addEventListener('securitypolicyviolation', event => self.postMessage({
  kind: 'csp', source: 'worker', blockedURI: event.blockedURI,
  effectiveDirective: event.effectiveDirective, originalPolicy: event.originalPolicy,
}));

async function gpuInfo() {
  if (!navigator.gpu) return { available: false, error: 'navigator.gpu is undefined' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { available: false, error: 'navigator.gpu.requestAdapter returned null' };
  const info = adapter.info;
  return { available: true, vendor: info.vendor, architecture: info.architecture,
    device: info.device, description: info.description, features: [...adapter.features],
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
}

self.onmessage = async ({ data: { runtime, mode, sentences } }) => {
  const start = performance.now();
  let loaded;
  try {
    if (runtime === 'gpu') {
      self.postMessage({ kind: 'result', ok: true, gpu: await gpuInfo() });
      return;
    }
    if (runtime === 'transformers') {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: new URL(FACTORY, self.location).href,
        wasm: new URL(WASM, self.location).href,
      };
      if (mode === 'cache-bytes' || mode === 'cache-metadata') {
        const networkFetch = env.fetch;
        env.fetch = async (input, init) => {
          const url = new URL(input, self.location);
          url.pathname = url.pathname.replace(`/resolve/main/`, `/resolve/${REVISION}/`);
          const response = await caches.match(url.href);
          if (response) return response;
          const variant = new URL(self.location).searchParams.get('variant');
          if (variant !== 'V3' || !navigator.onLine) throw new Error(`Cache-only miss: ${url.href}`);
          return networkFetch(url.href, init);
        };
        if (mode === 'cache-bytes') {
          env.useWasmCache = false;
          const response = await caches.match(new URL(WASM, self.location).href);
          if (!response) throw new Error('Self-hosted WASM missing from shell cache');
          env.backends.onnx.wasm.wasmBinary = await response.arrayBuffer();
        }
      }
      const classifier = await pipeline('text-classification', MODEL, {
        revision: REVISION, device: 'wasm', dtype: 'q8',
      });
      loaded = performance.now();
      const outputs = [];
      for (const text of sentences) {
        const begin = performance.now();
        outputs.push({ input: text, output: await classifier(text), ms: performance.now() - begin });
      }
      await classifier.dispose();
      self.postMessage({ kind: 'result', ok: true, runtime, mode,
        loadMs: loaded - start, inferenceMs: performance.now() - loaded,
        totalMs: performance.now() - start, outputs });
      return;
    }
    const gpu = await gpuInfo();
    self.postMessage({ kind: 'gpu', ...gpu });
    if (!gpu.available) throw new Error(gpu.error);
    const record = prebuiltAppConfig.model_list.find(record => record.model_id === QWEN);
    if (!record) throw new Error(`Prebuilt model not found: ${QWEN}`);
    if (mode === 'cache-lib') {
      const response = await caches.match(new URL('/mlc/qwen3.wasm', self.location).href);
      if (!response) throw new Error('Self-hosted WebLLM library missing from shell cache');
      await (await caches.open('webllm/wasm')).put(new URL('/mlc/qwen3.wasm', self.location).href, response);
    }
    const appConfig = { cacheBackend: mode === 'indexeddb' ? 'indexeddb' : 'cache',
      model_list: [{ ...record, model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/resolve/8c14ce481d4c692769976ad52afea453a102df19/',
        model_lib: mode === 'cache-lib' ? new URL('/mlc/qwen3.wasm', self.location).href : '/mlc/qwen3.wasm',
        overrides: { context_window_size: 1024 } }] };
    const engine = await CreateMLCEngine(QWEN, { appConfig,
      initProgressCallback: progress => self.postMessage({ kind: 'progress', runtime, ...progress }),
    });
    loaded = performance.now();
    const outputs = [];
    for (const text of sentences) {
      const begin = performance.now();
      const response = await engine.chat.completions.create({
        messages: [{ role: 'user', content: `Label the sentiment positive, negative or neutral. Reply with one word. Sentence: ${text} /no_think` }],
        temperature: 0.7, top_p: 0.8, seed: 42, max_tokens: 12,
        extra_body: { enable_thinking: false },
      });
      outputs.push({ input: text, output: response.choices[0].message.content, usage: response.usage,
        ms: performance.now() - begin });
    }
    await engine.unload();
    self.postMessage({ kind: 'result', ok: true, runtime, mode, gpu,
      loadMs: loaded - start, inferenceMs: performance.now() - loaded,
      totalMs: performance.now() - start, outputs });
  } catch (error) {
    self.postMessage({ kind: 'result', ok: false, runtime, mode,
      totalMs: performance.now() - start, error: String(error), stack: error.stack });
  }
};
