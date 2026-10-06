import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const home = homedir();
const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const systemRoot = path.parse(home).root;
export const tempRoot = path.join(tmpdir(), 'kilo', 's2-classify');
export const chromePaths = [
  path.join(systemRoot, 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(systemRoot, 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
];
export async function machineLocations() {
  const defaultStore = path.join(home, '.ollama', 'models');
  const locations = {
    ollamaStore: defaultStore,
    ollamaActualStore: defaultStore,
    huggingFaceSharedCache: path.join(home, '.cache', 'huggingface'),
    playwrightSharedCache: path.join(localAppData, 'ms-playwright'),
    disposableProfilesAndTests: tempRoot,
    spikeCache: fileURLToPath(new URL('.cache', import.meta.url)),
    spikeDependencies: fileURLToPath(new URL('node_modules', import.meta.url)),
    spikeBuild: fileURLToPath(new URL('dist', import.meta.url)),
    spikeResults: fileURLToPath(new URL('results', import.meta.url)),
  };
  // Discover a nondefault store through local model metadata, never environment keys or config.
  try {
    const response = await fetch('http://127.0.0.1:11434/api/show', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3:0.6b' }),
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Ollama metadata HTTP ${response.status}`);
    const show = await response.json();
    const from = show.modelfile?.match(/^FROM\s+(.+)$/m)?.[1].trim().replace(/^"(.*)"$/, '$1');
    if (!from || !path.isAbsolute(from) || path.basename(path.dirname(from)) !== 'blobs') {
      throw new Error('Ollama metadata did not identify a local model-store blob');
    }
    locations.ollamaActualStore = path.dirname(path.dirname(from));
  } catch (error) {
    console.error(`Ollama store discovery unavailable; reporting the default location: ${error.message}`);
  }
  return locations;
}
export async function bytes(directory) {
  let total = 0, files = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { const child = await bytes(target); total += child.bytes; files += child.files; }
      else { total += (await stat(target)).size; files++; }
    }
    return { exists: true, bytes: total, files };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, bytes: 0, files: 0 }; throw error; }
}
export async function installedChrome() {
  const found = [];
  for (const executable of chromePaths) {
    try {
      await stat(executable);
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Item -LiteralPath '${executable}').VersionInfo.ProductVersion`]);
      found.push({ executable, version: stdout.trim() });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return found;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const locations = await machineLocations();
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), locations: Object.fromEntries(
    await Promise.all(Object.entries(locations).map(async ([name, directory]) => [name, { directory, ...await bytes(directory) }]))),
    installedChrome: await installedChrome() }, null, 2));
}
