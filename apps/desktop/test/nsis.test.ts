import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  assertCompressor,
  verifyNsisArchive,
  installerLists,
} from '../packaging/nsis-checks.ts';
import { directory } from '../packaging/paths.ts';
import * as checks from '../packaging/nsis-checks.ts';
import { inspectText } from '../../../tools/copy-check/src/index.ts';
import { deflateRawSync } from 'node:zlib';

test('stub architecture, compiler arguments and compiled string mutation controls reject first', () => {
  const stub = Buffer.alloc(256);
  stub.writeUInt32LE(64, 0x3c);
  stub.write('PE\0\0', 64);
  stub.writeUInt16LE(0x14c, 68);
  stub.writeUInt16LE(0x10b, 88);
  expect(() => checks.assertNsisStub(stub)).not.toThrow();
  stub.writeUInt16LE(0x8664, 68);
  expect(() => checks.assertNsisStub(stub)).toThrow('NSIS_STUB_ARCH_REFUSED');
  expect(() =>
    checks.assertCompileLog('Using zlib compression.', [
      '/XSetCompressor lzma',
    ]),
  ).toThrow('NSIS_COMPILE_REFUSED');
  expect(() => checks.assertCompileLog('Using lzma compression.', [])).toThrow(
    'NSIS_COMPILE_REFUSED',
  );
  const text = 'LangString Link ${LANG_GERMAN} "Nichts wurde geändert."';
  const header = deflateRawSync(
    Buffer.from('Nichts wurde geändert.', 'utf16le'),
  );
  const bytes = Buffer.alloc(36);
  Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex').copy(bytes, 4);
  bytes.writeUInt32LE((header.length | 0x80000000) >>> 0, 28);
  expect(() =>
    checks.assertCompiledMessages(
      Buffer.concat([bytes.subarray(0, 32), header]),
      text,
    ),
  ).not.toThrow();
  expect(() =>
    checks.assertCompiledMessages(
      Buffer.concat([bytes.subarray(0, 32), header]),
      text.replace('geändert', 'verändert'),
    ),
  ).toThrow('NSIS_MESSAGE_BYTES_MISMATCH');
});

test('installed controls contain the exact negative paths and restricted token never changes the installer', async () => {
  const controls = await readFile(
    join(directory, 'e2e/uninstall-controls.ts'),
    'utf8',
  );
  for (const branch of [
    'UPGRADE_OLD_FILE_REMAINS',
    'PARTIAL_REGISTRATION_REMOVED',
    'setup-redirect',
    'setup-root-junction',
    'uninstall-root-junction',
    'uninstall-running-registered-outer',
    'uninstall-running-registered-copy',
  ])
    expect(controls).toContain(branch);
  const limited = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(limited).toContain('CreateRestrictedToken(token,1|4');
  expect(limited).toContain('if(member) throw');
  expect(limited).toContain('CreateProcessAsUserW');
  const launcher = await readFile(
    join(directory, 'e2e/installed-proof.ts'),
    'utf8',
  );
  expect(launcher).toContain('ELEVATED_REFUSAL_CHANGED_LAYOUT');
  expect(launcher).not.toContain('buildNsis');
});

test('upgrade history is append-only and obsolete names are checked before deletion', () => {
  const lists = checks.installerLists as (
    current: string[],
    history: string[],
    previous: string[],
  ) => { obsolete: string; uninstall: string };
  expect(() => lists(['new.txt'], ['new.txt'], ['old.txt'])).toThrow(
    'NSIS_HISTORY_REMOVED:old.txt',
  );
  expect(() => lists(['new.txt'], [], [])).toThrow(
    'NSIS_HISTORY_MISSING:new.txt',
  );
  const result = lists(['new.txt'], ['old.txt', 'new.txt'], ['old.txt']);
  expect(result.obsolete).toContain('DeleteListed "" "old.txt"');
  expect(result.obsolete).not.toContain('new.txt');
  expect(result.uninstall).toContain('DeleteListed "un." "old.txt"');
  expect(result.uninstall).not.toContain('ReadINIStr');
});

test('sections recheck processes, preserve registration on partial removal and refuse admin tokens', async () => {
  const script = await readFile(
    join(directory, 'packaging/installer.nsi'),
    'utf8',
  );
  expect(script).toMatch(/Section "Install"\s+Call CheckRunning/);
  expect(script).toMatch(/Section "Uninstall"\s+Call un.CheckRunning/);
  expect(script).toContain('shell32::IsUserAnAdmin()');
  expect(script).toMatch(/ClearErrors\s+!include "\$\{UNINSTALL_LIST\}"/);
  expect(script).toMatch(/IfErrors uninstallPartial/);
  expect(script).toMatch(/uninstallPartial:[\s\S]*SetErrorLevel 12/);
  expect(script).toMatch(
    /Process32FirstW[^\n]+\n\s+IntCmp \$2 0 processFailureFree/,
  );
  expect(script).not.toContain('IntCmp $0 -1');
  expect(script).toContain('GetLastError');
  expect(script).toMatch(/IntCmp \$5 2 pathParent\s+IntCmp \$5 3 pathParent/);
});

test('all refusal codes have separate English and German messages checked by the copy word list', async () => {
  const script = await readFile(
    join(directory, 'packaging/installer.nsi'),
    'utf8',
  );
  const rows = [
    ...script.matchAll(
      /^LangString (\w+) \$\{LANG_(ENGLISH|GERMAN)\} "(.+)"$/gm,
    ),
  ];
  expect(rows.length).toBeGreaterThanOrEqual(12);
  for (const [, , , text] of rows) expect(inspectText(text!)).toEqual([]);
  expect(inspectText('safe guaranteed bypass')).not.toEqual([]);
});

test('compiler pins x86 structure layout, UTF-8 input, clean environment and checked zlib output', async () => {
  const source = await readFile(join(directory, 'packaging/nsis.ts'), 'utf8');
  expect(source).toContain('/INPUTCHARSET');
  expect(source).toContain('UTF8');
  expect(source).toContain('env:');
  expect(source).toContain('assertNsisStub');
  expect(source).toContain('assertCompileLog');
  expect(source).toContain('assertCompiledMessages');
  expect(source).not.toMatch(/from ['"][^'"]*e2e\//);
  expect(source).toContain('NSIS_HISTORY_SHALLOW_REFUSED');
  const release = await readFile(
    join(directory, 'packaging/release.ts'),
    'utf8',
  );
  expect(release).not.toMatch(/from ['"][^'"]*(?:e2e|test)\//);
  expect(release).toContain('NSIS_COPYING_MISSING');
});

test('wrong archive digest fails before extraction or compiler execution', () => {
  expect(() =>
    verifyNsisArchive(Buffer.from('generated archive'), '0'.repeat(64)),
  ).toThrow('NSIS_CHECKSUM_MISMATCH');
});

test('only one literal zlib compressor is admitted', () => {
  expect(() => assertCompressor('SetCompressor zlib\n')).not.toThrow();
  for (const source of [
    'SetCompressor lzma',
    'SetCompressor bzip2',
    'SetCompressor zlib\nSetCompressor lzma',
    'SetCompressor ${COMPRESSOR}',
    '',
  ])
    expect(() => assertCompressor(source)).toThrow('NSIS_COMPRESSOR_REFUSED');
});

test('file list comes from build inputs, escapes script syntax and removes only named files', () => {
  const result = installerLists([
    'SocialPrune.exe',
    'locales/en-US.pak',
    'resources/app.asar',
  ]);
  expect(result.files).toEqual([
    'SocialPrune.exe',
    'locales/en-US.pak',
    'resources/app.asar',
  ]);
  expect(result.uninstall).toContain(
    'DeleteListed "un." "resources\\app.asar"',
  );
  expect(result.uninstall).not.toMatch(/RMDir\s+\/r|Delete[^\n]*\*/i);
  expect(result.uninstall).toContain('Call un.CheckPath');
  expect(result.uninstall).toContain('RMDir "$INSTDIR\\locales"');
  for (const file of [
    '../outside',
    'resources/$TEMP',
    'a"b',
    'a\nb',
    '/absolute',
  ])
    expect(() => installerLists([file])).toThrow('NSIS_INPUT_PATH_REFUSED');
});

test('installer fixes the root, never kills processes and validates links in both modes', async () => {
  const script = await readFile(
    join(directory, 'packaging/installer.nsi'),
    'utf8',
  );
  assertCompressor(script);
  expect(script).toContain('RequestExecutionLevel user');
  expect(script).toContain('$LOCALAPPDATA\\Programs\\SocialPrune');
  expect(script).toContain('UNINSTALL_ROOT_REFUSED');
  expect(script).toContain('INSTALL_APP_RUNNING');
  expect(script).toContain('UNINSTALL_APP_RUNNING');
  expect(script).toContain('GetFileAttributesW');
  expect(script).not.toMatch(
    /RMDir\s+\/r|taskkill|TerminateProcess|ExecWait|ExecShell/i,
  );
});
