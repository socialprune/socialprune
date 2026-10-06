import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const tempRoot = 'C:/Users/denni/AppData/Local/Temp/kilo/s2-classify';
export const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/denni/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Users/denni/AppData/Local/Google/Chrome SxS/Application/chrome.exe',
];
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
  const locations = {
    ollamaStore: 'C:/Users/denni/.ollama/models',
    ollamaActualStore: 'D:/AI/Ollama/models',
    huggingFaceSharedCache: 'C:/Users/denni/.cache/huggingface',
    playwrightSharedCache: 'C:/Users/denni/AppData/Local/ms-playwright',
    disposableProfilesAndTests: tempRoot,
    spikeCache: fileURLToPath(new URL('.cache', import.meta.url)),
    spikeDependencies: fileURLToPath(new URL('node_modules', import.meta.url)),
    spikeBuild: fileURLToPath(new URL('dist', import.meta.url)),
    spikeResults: fileURLToPath(new URL('results', import.meta.url)),
  };
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), locations: Object.fromEntries(
    await Promise.all(Object.entries(locations).map(async ([name, directory]) => [name, { directory, ...await bytes(directory) }]))),
    installedChrome: await installedChrome() }, null, 2));
}
