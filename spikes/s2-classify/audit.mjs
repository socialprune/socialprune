import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';

const { stdout } = await promisify(execFile)('cmd.exe', ['/d', '/s', '/c', 'pnpm list --depth Infinity --json'],
  { cwd: import.meta.dirname, maxBuffer: 8 * 1024 * 1024 });
const rows = new Map();
const absentPlatformPackages = [];
async function walk(node) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const dependency of Object.values(node[section] || {})) {
      let pkg;
      try { pkg = JSON.parse(await readFile(path.join(dependency.path, 'package.json'), 'utf8')); }
      catch (error) {
        const name = dependency.path.split('node_modules').at(-1).replace(/^[/\\]/, '').replaceAll('\\', '/');
        if (error.code === 'ENOENT' && (name === 'fsevents' || name.startsWith('@esbuild/') || name.startsWith('@rollup/rollup-') || name === '@napi-rs/lzma-linux-x64-gnu')) {
          absentPlatformPackages.push(name); continue;
        }
        throw error;
      }
      const key = `${pkg.name}@${pkg.version}`;
      if (!rows.has(key)) rows.set(key, { name: pkg.name, version: pkg.version, license: pkg.license ?? pkg.licenses ?? null,
        linked: dependency.version.startsWith('link:') });
      await walk(dependency);
    }
  }
}
await walk(JSON.parse(stdout)[0]);
// pnpm does not expand link: dependencies, so also inspect the core's declared runtime graph.
async function linkedRuntime(directory, seen = new Set()) {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const require = createRequire(path.join(directory, 'package.json'));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (seen.has(name)) continue;
    seen.add(name);
    let packageFile;
    try { packageFile = require.resolve(`${name}/package.json`); }
    catch { packageFile = path.join(path.dirname(require.resolve(name)), '../package.json'); }
    const dependency = JSON.parse(await readFile(packageFile, 'utf8'));
    rows.set(`${dependency.name}@${dependency.version}`, { name: dependency.name, version: dependency.version,
      license: dependency.license, linked: false, via: 'linked core runtime' });
    await linkedRuntime(path.dirname(packageFile), seen);
  }
}
await linkedRuntime(path.resolve(import.meta.dirname, '../../packages/core'));
// The local core link is first-party code, not an unlicensed third-party dependency.
const rejected = [...rows.values()].filter(row => row.name !== '@socialprune/core' &&
  !/^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|\(MIT OR Apache-2\.0\))$/.test(row.license));
console.log(JSON.stringify([...rows.values()].sort((a, b) => a.name.localeCompare(b.name)), null, 2));
console.log('LICENSE_RECORDS', rows.size, 'LICENSE_REJECTED', JSON.stringify(rejected));
console.log('ABSENT_PLATFORM_BINARIES_NOT_AUDITED', JSON.stringify([...new Set(absentPlatformPackages)]));
process.exitCode = rejected.length ? 1 : 0;
