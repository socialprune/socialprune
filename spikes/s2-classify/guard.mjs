import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Task source must not contain symbolic links');
    if (['node_modules', 'dist', 'results', '.cache'].includes(entry.name)) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(file);
    else files.push(file);
  }
}
await walk('spikes/s2-classify');
await walk('fixtures/synthetic/classify');
files.push('docs/spikes/S2.md');
console.log('EXACT_S2_SOURCE_PATHS', JSON.stringify(files.sort()));
const child = spawn(process.execPath, ['tools/data-guard/src/cli.ts', ...files], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
