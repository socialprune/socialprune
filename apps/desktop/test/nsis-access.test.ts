import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
  RESTRICTED_LAUNCH_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { testEnvironment } from './process-environment.ts';
import { RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS } from './windows-test-budgets.ts';

const ps = (script: string, args: string[]) =>
  runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'e2e', script),
      ...args,
    ],
    {
      timeout:
        script === 'limited-token.ps1'
          ? RESTRICTED_LAUNCH_TIMEOUT_MS
          : WINDOWS_QUERY_TIMEOUT_MS,
      windowsHide: true,
      env: testEnvironment(),
    },
  );

test.skipIf(process.platform !== 'win32')(
  'restricted NSIS fetch reuses verified deny-delete tools without changing the parent tree',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-nsis-acl-'));
    let denied = false;
    try {
      await mkdir(join(root, 'parent'));
      await mkdir(join(root, 'child'));
      await ps('nsis-acl-fixture.ps1', ['-Root', root]);
      await ps('proof-acl.ps1', ['-Action', 'grant', '-Root', root]);
      const acl = await ps('proof-acl.ps1', [
        '-Action',
        'deny-delete',
        '-Root',
        root,
      ]);
      denied = true;
      expect(
        (JSON.parse(acl.stdout) as { currentUserSid: string }).currentUserSid,
      ).toMatch(/^S-1-/);
      const bytes = await readFile(join(root, 'parent/nsis-3.13.zip'));
      const expected = createHash('sha256').update(bytes).digest('hex');
      // Relocate only the output binding of the actual module under test. The
      // archive and deny-delete ACL are fixture inputs, not implementation rules.
      let source = await readFile(
        join(directory, 'packaging/nsis-fetch.ts'),
        'utf8',
      );
      source = source.replace(
        /import \{([^}]+)\} from '\.\/paths\.ts';/,
        (_all, names: string) =>
          `import { directory } from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/paths.ts')).href)}; const dist = ${JSON.stringify(join(root, 'parent'))}; void ${JSON.stringify(names)};`,
      );
      source = source.replace(
        /from '(\.\/[^']+)'/g,
        (_all, id: string) =>
          `from ${JSON.stringify(pathToFileURL(join(directory, 'packaging', id)).href)}`,
      );
      source = source.replace(
        /from '(@[^']+)'/g,
        (_all, id: string) => `from ${JSON.stringify(import.meta.resolve(id))}`,
      );
      const module = join(root, 'fetch.mts');
      await writeFile(module, source);
      const child = join(root, 'child.mjs');
      await writeFile(
        child,
        `import assert from 'node:assert/strict'; import {readFile,rename,writeFile} from 'node:fs/promises'; import {fetchNsis} from ${JSON.stringify(pathToFileURL(module).href)};
assert.deepEqual(process.argv.slice(2),['argument with spaces','second']);
await assert.rejects(rename(${JSON.stringify(join(root, 'parent/nsis-tools'))},${JSON.stringify(join(root, 'parent/moved'))}),e=>e.code==='EPERM'||e.code==='EACCES');
const result=await fetchNsis(${JSON.stringify(expected)},{workspace:${JSON.stringify(join(root, 'child'))}});
assert.equal(result.directory,${JSON.stringify(join(root, 'parent/nsis-tools/nsis-3.13'))});
await writeFile(result.directory+'/makensis.exe','generated corrupt compiler');
const replacement=await fetchNsis(${JSON.stringify(expected)},{workspace:${JSON.stringify(join(root, 'child'))}});
assert.ok(replacement.directory.startsWith(${JSON.stringify(join(root, 'child'))}));
assert.equal(await readFile(result.directory+'/makensis.exe','utf8'),'generated corrupt compiler');
assert.equal(await readFile(replacement.directory+'/makensis.exe','utf8'),'generated compiler, never executed');
assert.equal((await fetchNsis(${JSON.stringify(expected)},{workspace:${JSON.stringify(join(root, 'child'))}})).directory,replacement.directory);
await writeFile(replacement.directory+'/Stubs/zlib-x86-unicode','generated corrupt stub');
const third=await fetchNsis(${JSON.stringify(expected)},{workspace:${JSON.stringify(join(root, 'child'))}});
assert.notEqual(third.directory,replacement.directory);
assert.equal(await readFile(third.directory+'/Stubs/zlib-x86-unicode','utf8'),'generated stub, never executed');
console.log('ACL_REUSE_PASS: deny-delete verified, corrupted parent preserved, fresh child extraction verified and reused');`,
      );
      const args = join(root, 'arguments.json');
      const report = join(root, 'token.json');
      await writeFile(
        args,
        JSON.stringify([child, 'argument with spaces', 'second']),
      );
      const result = await ps('limited-token.ps1', [
        '-Executable',
        process.execPath,
        '-ArgumentsFile',
        args,
        '-TokenReport',
        report,
      ]);
      expect(result.stdout).toContain('ACL_REUSE_PASS');
      expect(
        JSON.parse((await readFile(report, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({
        adminMember: false,
        childExit: 0,
        integrity: 'medium',
        profile: { sameUserSid: true, parentHkcuMarkerRead: true },
      });
      expect(await readFile(join(root, 'parent/nsis-3.13.zip'))).toEqual(bytes);
    } finally {
      if (denied)
        await ps('proof-acl.ps1', ['-Action', 'restore', '-Root', root]);
      await rm(root, { recursive: true, force: true });
    }
  },
  RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS,
);
