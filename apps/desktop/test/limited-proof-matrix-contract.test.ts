import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { peImports } from './limited-proof-matrix.ts';

test('the diagnostic selector is opt-in and only the R30 default-DACL repair changes the frozen restricted launcher body', async () => {
  const source = (
    await readFile(join(directory, 'e2e/limited-token.ps1'), 'utf8')
  ).replaceAll('\r\n', '\n');
  expect(source.split('\n')[0]).toBe(
    "param([string]$Executable, [string]$ArgumentsFile, [string]$TokenReport, [int]$TimeoutSeconds = 1200, [string]$DiagnosticVariant = '')",
  );
  expect(source).toContain("if ($DiagnosticVariant -eq 'runner-matrix')");
  const unchanged = source
    .slice(source.indexOf('\n') + 1)
    .replace(
      /# DIAGNOSTIC_MATRIX_DISPATCH_BEGIN\n[\s\S]*?# DIAGNOSTIC_MATRIX_DISPATCH_END\n/,
      '',
    )
    .replace(
      /  \/\/ R30_DEFAULT_DACL_(TYPES|METHODS)_BEGIN\n[\s\S]*?  \/\/ R30_DEFAULT_DACL_\1_END\n/g,
      '',
    )
    .replace('      EnsureUserDefaultDacl(limited);\n', '')
    .replace(
      /; ?defaultDacl=\(\[LimitedProof\]::DefaultDaclEvidence\|ConvertFrom-Json\)/g,
      '',
    );
  expect(createHash('sha256').update(unchanged).digest('hex')).toBe(
    '9e9c64946cc327b05b1d2583158cd279948357e011e42d8ba0a5409b97edaaea',
  );
});

test('all existing restricted proof callsites, including failure controls and the installed launcher, are unchanged from 9b8d737', async () => {
  // Frozen from 9b8d737 inputs, not derived from the candidate implementation.
  for (const [path, sha256] of [
    [
      'e2e/installed-proof.ts',
      '881634cc218283bb420302346814fe0b6fe08a741a26af27aed7509e45b32f7b',
    ],
    [
      'test/fresh-profile.test.ts',
      '89b554973c440d21446b610e1c8b6c81d1df622f3e8df08588db6ea8201e2ab8',
    ],
    [
      'test/powershell.test.ts',
      '733b2eae5cc2860d4fb78f5bded283e071681c9963655990e65ded93930461e1',
    ],
    [
      'test/proof-isolation.test.ts',
      '2c1e8740c55b08221fc94b842752e9303d6f762e712349990a4256cb54c947d7',
    ],
    [
      'test/nsis-access.test.ts',
      '55a7ab79d3e4536366fddb151937ead15986d2e69306def612c2ab9932fca8fe',
    ],
    [
      'test/limited-proof-diagnostics.test.ts',
      'b24950130fd41057b0b9fbbd872712a5a30b096da265048dc63f3586fe4e0bba',
    ],
  ]) {
    const source = (await readFile(join(directory, path!), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(createHash('sha256').update(source).digest('hex'), path).toBe(
      sha256,
    );
    expect(source).not.toContain('-DiagnosticVariant');
  }
});

test('the DACL reproducer records the elevation precondition rather than asserting its mechanism for an elevated parent', async () => {
  const source = await readFile(
    join(directory, 'test/desktop-access.test.ts'),
    'utf8',
  );
  const fixture = await readFile(
    join(directory, 'test/desktop-access-fixture.ps1'),
    'utf8',
  );
  expect(source).toContain('result.parentElevated === true');
  expect(source).toContain('DESKTOP_ACCESS_PRECONDITION');
  expect(fixture).toContain('ParentElevated()');
});

test('import inspection reads generated PE import and delay tables without claiming a user32-free runtime', () => {
  const bytes = Buffer.alloc(2048);
  bytes.write('MZ');
  bytes.writeUInt32LE(128, 0x3c);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152);
  bytes.writeUInt32LE(0x1000, 272);
  bytes.writeUInt32LE(0x1040, 368);
  bytes.writeUInt32LE(1024, 400);
  bytes.writeUInt32LE(0x1000, 404);
  bytes.writeUInt32LE(1024, 408);
  bytes.writeUInt32LE(512, 412);
  bytes.writeUInt32LE(0x1100, 524);
  bytes.write('USER32.dll\0', 768);
  bytes.writeUInt32LE(1, 576);
  bytes.writeUInt32LE(0x1120, 580);
  bytes.write('KERNEL32.dll\0', 800);
  expect(peImports(bytes)).toEqual({
    direct: ['USER32.dll'],
    delayed: ['KERNEL32.dll'],
    transitiveImportsChecked: false,
    user32FreeClaim: false,
  });
  expect(() => peImports(Buffer.alloc(128))).toThrow('MATRIX_NOT_PE');
});
