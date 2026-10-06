import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const buildInputs = ['index.html', 'src/page.mjs', 'src/worker.mjs', 'models.mjs', 'vite.config.mjs', 'package.json', 'pnpm-lock.yaml'];
const runtimeInputs = [...buildInputs, 'provenance.mjs', 'run.mjs', 'browser-tier.mjs', 'contract.mjs', 'http-tiers.mjs',
  'rules.mjs', 'metrics.mjs', '../../packages/core/src/model/index.ts', '../../packages/core/package.json'];
async function identity(files) {
  const records = Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async file => [file,
    createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])));
  return { hash: createHash('sha256').update(JSON.stringify(records)).digest('hex'), files: records };
}
export const buildIdentity = () => identity(buildInputs);
export const sourceIdentity = () => identity(runtimeInputs);
