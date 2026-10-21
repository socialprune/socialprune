import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { directory } from '../packaging/paths.ts';
import { peImports } from '../test/limited-proof-matrix.ts';

export async function buildTokenProbe(output: string) {
  await mkdir(output, { recursive: true });
  const found = await runNativeQuery(
    'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { timeout: 10_000, windowsHide: true },
  );
  const installation = found.stdout.trim();
  if (!installation || installation.includes('\n'))
    throw new Error('TOKEN_COMPILER_REQUIRED');
  const source = join(directory, 'e2e/token-probe.cpp');
  const executable = join(output, 'token-probe.exe');
  const quote = (value: string) => `"${value}"`;
  const command = `"${quote(join(installation, 'VC/Auxiliary/Build/vcvars64.bat'))} >nul && cl.exe /nologo /W4 /WX /O2 /MT /EHsc /std:c++20 /DUNICODE /D_UNICODE ${quote(source)} /Fo${quote(join(output, 'token-probe.obj'))} /Fe${quote(executable)} /link /SUBSYSTEM:WINDOWS /INCREMENTAL:NO advapi32.lib kernel32.lib"`;
  const compiled = await runNativeQuery(
    'cmd.exe',
    ['/d', '/s', '/c', command],
    {
      timeout: 60_000,
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );
  process.stdout.write(compiled.stdout);
  const bytes = await readFile(executable);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt16LE(pe + 24 + 68) !== 2)
    throw new Error('TOKEN_HELPER_NOT_WINDOWS_SUBSYSTEM');
  const imports = peImports(bytes);
  if (
    [...imports.direct, ...imports.delayed].some((name) =>
      /^(?:user32|gdi32|ole32|oleaut32|combase|shell32)\.dll$/i.test(name),
    )
  )
    throw new Error('TOKEN_HELPER_UI_IMPORT');
  return {
    executable,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    subsystem: 'windows',
    imports,
    sourceSha256: createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await buildTokenProbe(resolve(process.argv[2]!))));
