import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { directory } from '../packaging/paths.ts';
import { proofOutput } from './proof-context.ts';
import { runProof } from './proof-runtime.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The sole installed-proof child entry. Imported test modules can write only
// through this run's workspace, never into the elevated builder's outputs.
const mode = process.argv[2]!;
const workspace = process.argv[3]!;
assert.ok(['red', 'faults', 'controls', 'smoke', 'foundation'].includes(mode));
const entries = {
  red: 'e2e/release-controls.ts',
  faults: 'e2e/installer-fault-controls.ts',
  controls: 'e2e/uninstall-controls.ts',
  smoke: 'packaging/release-smoke.ts',
  foundation: 'e2e/installer-foundation.ts',
};
const entry = entries[mode as keyof typeof entries];
process.exitCode = await runProof(
  mode,
  workspace,
  join(directory, entry),
  async () => {
    const layout = JSON.parse(
      (
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            join(directory, 'packaging/install-layout.ps1'),
          ],
          { timeout: 30_000, windowsHide: true },
        )
      ).stdout,
    ) as { install: string; installExists: boolean; dataExists: boolean };
    assert.equal(layout.installExists, false, 'EXISTING_INSTALL_REFUSED');
    assert.equal(layout.dataExists, false, 'EXISTING_DATA_REFUSED');
    // Exercise the actual token at the install parent without precreating the
    // fixed app root or altering its ACL. Only this random sibling is owned.
    await mkdir(dirname(layout.install), { recursive: true });
    const probe = await mkdtemp(
      join(dirname(layout.install), 'socialprune-write-proof-'),
    );
    try {
      await writeFile(join(probe, 'created'), 'generated');
      await rename(join(probe, 'created'), join(probe, 'renamed'));
      assert.equal(await readFile(join(probe, 'renamed'), 'utf8'), 'generated');
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
    const paths = join(workspace, 'child-acl-paths.json');
    await writeFile(
      paths,
      JSON.stringify([
        { label: 'child-evidence', path: join(workspace, 'evidence') },
        { label: 'child-temp', path: join(workspace, 'temp') },
        { label: 'install-parent', path: dirname(layout.install) },
      ]),
    );
    const acl = JSON.parse(
      (
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            join(directory, 'e2e/proof-acl.ps1'),
            '-Action',
            'inspect',
            '-Root',
            workspace,
            '-PathsFile',
            paths,
          ],
          { timeout: 30_000, windowsHide: true },
        )
      ).stdout,
    ) as unknown;
    await writeFile(
      proofOutput(`release-child-access-${mode}.json`),
      JSON.stringify(
        { acl, installParentWritable: true, createRenameReadDelete: true },
        null,
        2,
      ),
    );
    await import(new URL(`../${entry}`, import.meta.url).href);
  },
);
