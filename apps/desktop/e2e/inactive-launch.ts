import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { spawnPowerShell } from '../packaging/windows-powershell.ts';

export async function launchInactive(
  executable: string,
  args: string[],
  showCommand: 4 | 7,
) {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-inactive-'));
  const argumentsFile = join(scratch, 'arguments.json');
  const receipt = join(scratch, 'launch.json');
  await writeFile(argumentsFile, JSON.stringify(args));
  const child = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(import.meta.dirname, 'inactive-launch.ps1'),
      '-Executable',
      executable,
      '-ArgumentsFile',
      argumentsFile,
      '-Receipt',
      receipt,
      '-ShowCommand',
      String(showCommand),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let errors = '';
  child.stdout.resume();
  child.stderr.on('data', (bytes: Buffer) => {
    errors += bytes.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  try {
    const deadline = Date.now() + 30_000;
    let launch: {
      pid: number;
      showCommand: number;
      startupFlags: number;
      ownedJob: boolean;
    };
    while (true) {
      try {
        launch = JSON.parse(await readFile(receipt, 'utf8')) as typeof launch;
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      }
      if (child.exitCode !== null || Date.now() > deadline)
        throw new Error(`INACTIVE_LAUNCH_FAILED:${errors}`);
      await wait(25);
    }
    return {
      ...launch,
      exited,
      errors: () => errors,
      async close() {
        if (child.exitCode === null) child.kill();
        await exited;
        await rm(scratch, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
