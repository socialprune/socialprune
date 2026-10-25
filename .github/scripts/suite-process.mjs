import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';

export async function runProcess(executable, args, options) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  for (const [stream, name] of [
    [child.stdout, 'stdout'],
    [child.stderr, 'stderr'],
  ])
    stream.on('data', (bytes) => options.onOutput(bytes, name));
  let timedOut = false,
    launchError = null,
    termination = null;
  let terminating = Promise.resolve();
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.pid) return;
    if (process.platform === 'win32')
      terminating = new Promise((done) => {
        const killer = spawn(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        for (const stream of [killer.stdout, killer.stderr])
          stream.on('data', (bytes) => options.onOutput(bytes, 'termination'));
        killer.once('error', (error) => {
          termination = { exitCode: null, error: error.code };
          done();
        });
        killer.once('close', (exitCode) => {
          termination = { exitCode };
          done();
        });
      });
    else {
      try {
        process.kill(-child.pid, 'SIGKILL');
        termination = { exitCode: 0 };
      } catch (error) {
        termination = { exitCode: null, error: error.code };
      }
    }
  }, options.timeoutMs);
  const exitCode = await new Promise((done) => {
    child.once('error', (error) => {
      launchError = error.code ?? 'SPAWN_FAILED';
      options.onOutput(Buffer.from(error.message + '\n'), 'stderr');
      done(null);
    });
    child.once('close', done);
  });
  clearTimeout(timer);
  await terminating;
  return { exitCode, timedOut, launchError, termination };
}
