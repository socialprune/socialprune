import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mlcLibraryRevision, webModels } from './models.mjs';
import { buildIdentity } from './provenance.mjs';

const require = createRequire(import.meta.url);
const ortDirectory = path.dirname(require.resolve('onnxruntime-web'));
export default defineConfig({ worker: { format: 'es' },
  build: { target: 'esnext', chunkSizeWarningLimit: 12000 },
  plugins: [{ name: 's2-local-runtime-assets',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-identity.json', source: JSON.stringify(await buildIdentity()) });
      for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: await readFile(path.join(ortDirectory, name)) });
      }
      for (const record of Object.values(webModels)) {
        const url = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${mlcLibraryRevision}/web-llm-models/v0_2_84/base/${record.library}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Pinned model library HTTP ${response.status}`);
        this.emitFile({ type: 'asset', fileName: `mlc/${record.library}`, source: new Uint8Array(await response.arrayBuffer()) });
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://huggingface.co https://us.aws.cdn.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://cas-bridge.xethub.hf.co; style-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        response.setHeader('Cache-Control', 'no-store');
        next();
      });
    } } ] });
