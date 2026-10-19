import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFuses } from './fuses.ts';
import { directory, dist, executable } from './paths.ts';
import { runPowerShell } from './windows-powershell.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';

if (process.platform !== 'win32') throw new Error('WINDOWS_SMOKE_REQUIRED');
await assertFuses(executable('release'), false);
const data = await mkdtemp(join(tmpdir(), 'socialprune-desktop-smoke-'));
const count = await generatedWorkspace(data);
const started = Date.now();
const child = spawn(
  executable('release'),
  [`--data-dir=${data}`, '--force-renderer-accessibility'],
  { stdio: 'pipe', windowsHide: false },
);
let errorText = '';
child.stdout.resume();
child.stderr.on('data', (data: Buffer) => {
  errorText += data.toString();
});
const exited = new Promise<number | null>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
try {
  if (!child.pid) throw new Error('SMOKE_NO_PID');
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/smoke-window.ps1'),
      '-AppProcessId',
      String(child.pid),
      '-Executable',
      executable('release'),
      '-ExpectedItems',
      String(count),
    ],
    { timeout: 60_000, windowsHide: true },
  );
  const sample = JSON.parse(stdout) as {
    interactiveAt: number;
    workingSetBytes: number;
    tcpListeners: number;
    tcpConnections: number;
    udpEndpoints: number;
    processCount: number;
    items: number;
  };
  assert.equal(await exited, 0, 'SMOKE_EXIT');
  assert.equal(sample.items, count);
  assert.equal(sample.tcpListeners, 0);
  assert.equal(sample.tcpConnections, 0);
  assert.equal(sample.udpEndpoints, 0);
  assert.deepEqual(await appProcesses(executable('release')), []);
  assert.doesNotMatch(
    errorText,
    /DESKTOP_START_FAILED|DESKTOP_LOG_WRITE_FAILED|Debugger listening/,
  );
  const assembly = JSON.parse(
    await readFile(join(dist, 'assembly.json'), 'utf8'),
  ) as { asarSha256: string };
  const evidence = {
    proof: 'release-packaged-smoke',
    asarSha256: assembly.asarSha256,
    startupMs: sample.interactiveAt - started,
    workingSetBytes: sample.workingSetBytes,
    processCount: sample.processCount,
    asarBytes: (await stat(join(dist, 'release/resources/app.asar'))).size,
    items: count,
    tcpListeners: 0,
    tcpConnections: 0,
    udpEndpoints: 0,
    remainingOwnedProcesses: 0,
  };
  await writeFile(join(dist, 'smoke.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
  await rm(data, { recursive: true, force: true });
}
