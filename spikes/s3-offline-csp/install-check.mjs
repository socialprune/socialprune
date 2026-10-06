import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('../..');
const names = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc'];
async function snapshot() {
  return Object.fromEntries(await Promise.all(names.map(async name => {
    try {
      return [name, createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return [name, 'absent'];
    }
  })));
}
const before = await snapshot();
console.log('ROOT_BEFORE', JSON.stringify(before));
const code = await new Promise(resolve => {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm install'], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', resolve);
});
const after = await snapshot();
console.log('ROOT_AFTER', JSON.stringify(after));
const unchanged = JSON.stringify(before) === JSON.stringify(after);
console.log('ROOT_UNCHANGED', unchanged, 'INSTALL_EXIT', code);
process.exitCode = code || (unchanged ? 0 : 2);
