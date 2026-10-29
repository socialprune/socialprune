import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const prefix = 'socialprune-helper-run-';
const owned = new Set<string>();
const started = Date.now();

export function cleanStaleHelperScratch(root = tmpdir(), before = started) {
  for (const name of readdirSync(root)) {
    if (!name.startsWith(prefix)) continue;
    const folder = join(root, name);
    try {
      if (
        !lstatSync(folder).isDirectory() ||
        lstatSync(folder).isSymbolicLink()
      )
        continue;
      const owner = JSON.parse(
        readFileSync(join(folder, 'owner.json'), 'utf8'),
      ) as {
        kind: string;
        pid: number;
        started: number;
      };
      if (
        owner.kind !== prefix ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        !Number.isFinite(owner.started) ||
        owner.started >= before
      )
        continue;
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
          rmSync(folder, { recursive: true, force: true });
      }
    } catch {
      /* Foreign, incomplete or unreadable folders are retained. */
    }
  }
}

let initialized = false;
export function prepareHelperScratch() {
  if (!initialized) {
    cleanStaleHelperScratch();
    process.once('exit', () => {
      for (const folder of owned) {
        try {
          rmSync(folder, { recursive: true, force: true });
        } catch {
          console.error('HELPER_SCRATCH_CLEANUP_FAILED');
        }
      }
    });
    initialized = true;
  }
}

export function createHelperScratch(purpose: string) {
  prepareHelperScratch();
  const folder = mkdtempSync(join(tmpdir(), prefix));
  owned.add(folder);
  writeFileSync(
    join(folder, 'owner.json'),
    JSON.stringify({
      kind: prefix,
      pid: process.pid,
      started: Date.now(),
      purpose,
    }),
  );
  return folder;
}
