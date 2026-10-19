import { spawn } from 'node:child_process';
import { join } from 'node:path';
const child = spawn(
  process.execPath,
  [join(import.meta.dirname, 'network-control-child.ts')],
  { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true },
);
child.stdout.pipe(process.stdout);
process.stdin.pipe(child.stdin);
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
