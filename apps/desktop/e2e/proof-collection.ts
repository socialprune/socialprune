import assert from 'node:assert/strict';
import { copyFile, lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../packaging/file-presence.ts';

export async function collectProof(workspace: string, output: string) {
  const collected: string[] = [];
  for (const folder of [workspace, join(workspace, 'evidence')]) {
    if (!(await pathExists(folder))) continue;
    assert.equal(
      (await lstat(folder)).isSymbolicLink(),
      false,
      'PROOF_EVIDENCE_LINK_REFUSED',
    );
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !/^release-[\w.-]+\.json$/.test(entry.name))
        continue;
      assert.equal(
        collected.includes(entry.name),
        false,
        'PROOF_EVIDENCE_DUPLICATE',
      );
      const input = join(folder, entry.name);
      assert.equal(
        (await lstat(input)).isSymbolicLink(),
        false,
        'PROOF_EVIDENCE_LINK_REFUSED',
      );
      await copyFile(input, join(output, entry.name));
      collected.push(entry.name);
    }
  }
  const summary = join(workspace, 'evidence/summary.md');
  return {
    collected,
    summary: (await pathExists(summary)) ? await readFile(summary) : null,
  };
}
