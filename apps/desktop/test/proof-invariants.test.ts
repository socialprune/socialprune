import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  assertProductSandbox,
  assertReadinessPredicate,
  assertRestrictedProofLauncher,
} from './proof-invariants.ts';

test('sandbox removal, conditional enablement and disabling switches fail without pinning unrelated app changes', async () => {
  const app = await readFile(join(directory, 'src/main/app.ts'), 'utf8');
  expect(() => assertProductSandbox(app)).not.toThrow();
  expect(() =>
    assertProductSandbox(app + '\nconst unrelated = 1;'),
  ).not.toThrow();
  for (const mutation of [
    app.replace('app.enableSandbox();', '// app.enableSandbox();'),
    app.replace('app.enableSandbox();', 'if (false) app.enableSandbox();'),
    app.replace('app.enableSandbox();', 'app.enableSandbox(false);'),
    app + "\napp.commandLine.appendSwitch('no-sandbox');",
  ])
    expect(() => assertProductSandbox(mutation)).toThrow(
      'PRODUCT_SANDBOX_REQUIRED',
    );
});

test('planted focus and visibility predicate changes fail the independent frozen readiness check', async () => {
  const file = 'packaging/window-readiness.ps1';
  const source = await readFile(join(directory, file), 'utf8');
  expect(() => assertReadinessPredicate(file, source)).not.toThrow();
  const mutation = source.replace(
    '$last.focusResult -and -not $last.offscreen',
    '$true',
  );
  expect(mutation).not.toBe(source);
  expect(() => assertReadinessPredicate(file, mutation)).toThrow(
    'READINESS_PREDICATE_CHANGED',
  );
});

test('restricted launch semantics reject weakened groups, token flags and unowned children without a whole-file pin', async () => {
  const source = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(() => assertRestrictedProofLauncher(source)).not.toThrow();
  for (const mutation of [
    source.replace(
      'CreateRestrictedToken(token,1|4',
      'CreateRestrictedToken(token,1',
    ),
    source.replace('if(member) throw', 'if(false) throw'),
    source.replace('info=StartOwned(limited,job', 'info=StartOwned(token,job'),
  ])
    expect(() => assertRestrictedProofLauncher(mutation)).toThrow(
      'RESTRICTED_PROOF_INVARIANT',
    );
});
