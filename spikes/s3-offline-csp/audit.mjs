import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const rows = [];
const { stdout } = await promisify(execFile)('cmd.exe', ['/d', '/s', '/c', 'pnpm list --depth Infinity --json'], { maxBuffer: 4 * 1024 * 1024 });
async function walk(node) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const dependency of Object.values(node[section] || {})) {
      try {
        const pkg = JSON.parse(await readFile(path.join(dependency.path, 'package.json'), 'utf8'));
        if (!rows.some(row => row.name === pkg.name && row.version === pkg.version)) {
          rows.push({ name: pkg.name, version: pkg.version, license: pkg.license || pkg.licenses });
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await walk(dependency);
    }
  }
}
await walk(JSON.parse(stdout)[0]);
rows.sort((a, b) => a.name.localeCompare(b.name));
console.log(JSON.stringify(rows, null, 2));
const rejected = rows.filter(row => !/^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|\(MIT OR Apache-2\.0\))$/.test(row.license));
console.log('LICENSE_REJECTED', JSON.stringify(rejected));
console.log('LICENSE_RECORDS', rows.length);
process.exitCode = rejected.length ? 1 : 0;
