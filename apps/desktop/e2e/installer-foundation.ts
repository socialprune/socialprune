import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { directory } from '../packaging/paths.ts';
import { artifacts, releaseVersion } from '../packaging/release.ts';
import { createHash } from 'node:crypto';
import { assertNsisTemp } from '../packaging/release-temp.ts';
import { pathExists } from '../packaging/file-presence.ts';
import { runPowerShell } from '../packaging/windows-powershell.ts';

const run = promisify(execFile);
const layout = async () =>
  JSON.parse(
    (
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'packaging/install-layout.ps1'),
        ],
        { timeout: 30_000 },
      )
    ).stdout,
  ) as {
    install: string;
    installExists: boolean;
    dataExists: boolean;
    registrations: string[];
  };
const initial = await layout();
assert.equal(initial.installExists, false);
assert.equal(initial.dataExists, false);
assert.deepEqual(initial.registrations, []);
const scratch = await mkdtemp(join(tmpdir(), 'socialprune-foundation-'));
const env = {
  // eslint-disable-next-line no-restricted-properties -- Explicit OS directory only.
  SystemRoot: process.env.SystemRoot,
  TEMP: scratch,
  TMP: scratch,
};
const uninstall = join(initial.install, 'Uninstall.exe');
try {
  await run(
    join(artifacts, `SocialPrune-Setup-${await releaseVersion()}.exe`),
    ['/S'],
    { env, timeout: 120_000 },
  );
  assert.equal((await layout()).registrations.length, 1);
  await access(join(initial.install, 'SocialPrune.exe'));
} catch (error) {
  console.error('FOUNDATION_CAUSE', error);
  throw error;
} finally {
  if (await pathExists(uninstall)) {
    const hash = createHash('sha256')
      .update(await readFile(uninstall))
      .digest('hex');
    await run(uninstall, ['/S'], { env, timeout: 60_000 });
    const deadline = Date.now() + 30_000;
    while ((await layout()).installExists && Date.now() < deadline)
      await wait(100);
    assert.equal((await layout()).installExists, false);
    assert.deepEqual((await layout()).registrations, []);
    await assertNsisTemp(scratch, 1, hash);
  }
  await rm(scratch, { recursive: true, force: true });
}
console.log(
  'FOUNDATION_PASS: limited token, real Setup, one registration, real normal uninstall, program removed, bounded temp copy',
);
