import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const files = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
async function hashes() {
  return Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')])));
}
const before = await hashes();
console.log('ROOT_BEFORE', JSON.stringify(before));
const child = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm install'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'inherit', 'inherit'],
});
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
const after = await hashes();
console.log('ROOT_AFTER', JSON.stringify(after));
const unchanged = JSON.stringify(before) === JSON.stringify(after);
console.log('ROOT_BYTE_IDENTICAL', unchanged);
process.exitCode = code || (unchanged ? 0 : 1);
