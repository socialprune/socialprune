import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { assertRestrictedProofLauncher } from './proof-invariants.ts';
import { peImports } from './pe-imports.ts';

test('the retired calibration matrix has no selector and the launcher retains the restricted proof invariants', async () => {
  const source = (
    await readFile(join(directory, 'e2e/limited-token.ps1'), 'utf8')
  ).replaceAll('\r\n', '\n');
  expect(source.split('\n')[0]).toBe(
    'param([string]$Executable, [string]$ArgumentsFile, [string]$TokenReport, [int]$TimeoutSeconds = 1200)',
  );
  expect(source).not.toMatch(
    /DiagnosticVariant|runner-matrix|limited-proof-matrix/,
  );
  expect(() => assertRestrictedProofLauncher(source)).not.toThrow();
});

test('restricted proof callsites cannot opt into a diagnostic or lose their restricted launcher', async () => {
  for (const path of [
    'e2e/installed-proof.ts',
    'test/fresh-profile.test.ts',
    'test/powershell.test.ts',
    'test/proof-isolation.test.ts',
    'test/nsis-access.test.ts',
    'test/limited-proof-diagnostics.test.ts',
  ]) {
    const source = await readFile(join(directory, path), 'utf8');
    expect(source, path).toContain('limited-token.ps1');
    expect(source).not.toContain('-DiagnosticVariant');
    expect(source).not.toMatch(
      /diagnose-launch\.ps1|token-launch\.cs|token-[BCDE]-/,
    );
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

test('retained diagnostic import inspection reads generated PE tables without a transitive runtime claim', () => {
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
