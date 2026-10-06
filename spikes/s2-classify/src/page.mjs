const state = document.querySelector('#state');
let worker, counter = 0, promptSession;
const pending = new Map();
const options = { expectedInputs: [{ type: 'text', languages: ['en', 'de'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
function request(message) {
  const id = ++counter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject }); worker.postMessage({ id, ...message });
  });
}
window.s2Initialize = async (tier, model) => {
  if (tier === 'prompt-api') {
    if (!globalThis.LanguageModel) throw new Error('PROMPT_API_BLOCKED: LanguageModel is not exposed by this browser');
    const availability = await LanguageModel.availability(options);
    if (availability === 'unavailable') throw new Error('PROMPT_API_BLOCKED: LanguageModel.availability returned unavailable');
    const button = document.querySelector('#prompt-start'); button.hidden = false;
    window.s2PromptReady = new Promise((resolve, reject) => {
      button.onclick = async () => {
        try { promptSession = await LanguageModel.create(options); resolve({ availability, model: 'Chrome managed Gemini Nano', options }); }
        catch (error) { reject(error); }
      };
    });
    return { availability, needsClick: true };
  }
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.progress) { state.textContent = data.progress; return; }
    const waiter = pending.get(data.id); if (!waiter) return;
    pending.delete(data.id); data.error ? waiter.reject(new Error(data.error)) : waiter.resolve(data.result);
  };
  worker.onerror = event => { for (const waiter of pending.values()) waiter.reject(new Error(event.message)); pending.clear(); };
  return request({ operation: 'initialize', tier, model });
};
window.s2Classify = async payload => {
  if (promptSession) {
    // Fresh context for every item; prior smoke/eval items never become few-shot examples.
    const session = await LanguageModel.create({ ...options, initialPrompts: [payload.messages[0]] });
    try { return { raw: await session.prompt(payload.messages[1].content, { responseConstraint: payload.schema }), transportOk: true }; }
    finally { session.destroy(); }
  }
  return request({ operation: 'classify', ...payload });
};
window.s2Close = async () => {
  if (promptSession) { promptSession.destroy(); promptSession = null; }
  if (worker) { try { await request({ operation: 'close' }); } finally { worker.terminate(); worker = null; } }
};
window.s2CacheSizes = async () => {
  const result = [];
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const key of await cache.keys()) {
      const response = await cache.match(key), reader = response.body.getReader();
      let bytes = 0;
      while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; }
      result.push({ cache: name, url: key.url, bytes });
    }
  }
  return result;
};
window.s2Ready = true;
