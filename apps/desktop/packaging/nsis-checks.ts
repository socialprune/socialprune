import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export function verifyNsisArchive(bytes: Uint8Array, expected: string): string {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected)
    throw new Error('NSIS_CHECKSUM_MISMATCH');
  return actual;
}

export function assertCompressor(script: string): void {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(';'));
  const compressors = lines.filter((line) => /^SetCompressor\b/i.test(line));
  if (compressors.length !== 1 || compressors[0] !== 'SetCompressor zlib')
    throw new Error('NSIS_COMPRESSOR_REFUSED');
}

function paths(input: readonly string[]): string[] {
  if (!Array.isArray(input) || input.some((file) => typeof file !== 'string'))
    throw new Error('NSIS_INPUT_PATH_REFUSED');
  const files = input as readonly string[];
  for (const file of files)
    if (
      !/^[\w .\-/]+$/.test(file) ||
      file.startsWith('/') ||
      file.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('NSIS_INPUT_PATH_REFUSED');
  if (new Set(files.map((file) => file.toLowerCase())).size !== files.length)
    throw new Error('NSIS_INPUT_PATH_REFUSED');
  return [...files];
}

export function installerLists(
  input: readonly string[],
  history: readonly string[] = input,
  previous: readonly string[] = history,
) {
  const files = paths(input).sort();
  const historical = paths(history);
  const generated = ['installed-files.json', 'Uninstall.exe'];
  if (
    files.some((file) =>
      generated.some((name) => name.toLowerCase() === file.toLowerCase()),
    )
  )
    throw new Error('NSIS_INPUT_PATH_REFUSED');
  const union = [...new Set([...historical, ...generated])];
  const baseline = paths(previous);
  for (const [index, file] of baseline.entries())
    if (historical[index] !== file)
      throw new Error(`NSIS_HISTORY_REMOVED:${file}`);
  for (const file of files)
    if (!historical.includes(file))
      throw new Error(`NSIS_HISTORY_MISSING:${file}`);
  const folders = [
    ...new Set(
      union.flatMap((file) => {
        const parts = file.split('/');
        return parts
          .slice(0, -1)
          .map((_, index) => parts.slice(0, index + 1).join('/'));
      }),
    ),
  ].sort(
    (a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a),
  );
  const win = (file: string) => file.replaceAll('/', '\\');
  const install = files
    .map((file) => `  !insertmacro InstallFile "${win(file)}"`)
    .join('\n');
  // Both deletion and empty-directory removal check every ancestor for a
  // reparse point. Unknown paths are never enumerated or passed to Delete.
  const deletion = (prefix: string, names: readonly string[]) =>
    names
      .map((file) => `  !insertmacro DeleteListed "${prefix}" "${win(file)}"`)
      .join('\n');
  const obsolete = deletion(
    '',
    union.filter((file) => !files.includes(file) && !generated.includes(file)),
  );
  const uninstall =
    deletion(
      'un.',
      union.filter((file) => file !== 'Uninstall.exe'),
    ) +
    '\n  IfErrors uninstallPartial\n' +
    deletion('un.', ['Uninstall.exe']) +
    '\n  IfErrors uninstallPartial\n' +
    [...folders, '']
      .map(
        (folder, i) =>
          `  StrCpy $CheckInput "$INSTDIR${folder ? '\\' + win(folder) : ''}"\n  Call un.CheckPath\n  StrCmp $CheckResult 0 0 skipFolder${i}\n  RMDir "$INSTDIR${folder ? '\\' + win(folder) : ''}"\n  skipFolder${i}:\n  ClearErrors`,
      )
      .join('\n');
  const verify = union
    .filter((file) => !generated.includes(file))
    .map((file) => `  !insertmacro VerifyPath "${win(file)}"`)
    .join('\n');
  return { files, folders, install, uninstall, verify, obsolete };
}

export function assertNsisStub(bytes: Buffer, script?: string): void {
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : bytes.length;
  if (
    pe + 26 > bytes.length ||
    bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' ||
    bytes.readUInt16LE(pe + 4) !== 0x14c ||
    bytes.readUInt16LE(pe + 24) !== 0x10b
  )
    throw new Error('NSIS_STUB_ARCH_REFUSED');
  if (
    script &&
    (!script.includes('!define PROCESSENTRY32W_SIZE 556') ||
      !script.includes('!define PROCESSENTRY32W_NAME_OFFSET 36') ||
      !script.includes('IntOp $6 $1 + ${PROCESSENTRY32W_NAME_OFFSET}'))
  )
    throw new Error('NSIS_PROCESS_LAYOUT_REFUSED');
}

export function assertCompileLog(log: string, args: readonly string[]): void {
  if (
    !/Using zlib compression/i.test(log) ||
    /\b(?:lzma|bzip2)\b/i.test(log) ||
    args.some((arg) => /^\/X/i.test(arg))
  )
    throw new Error('NSIS_COMPILE_REFUSED');
}

export function assertCompiledMessages(bytes: Buffer, source: string): void {
  // The first non-solid zlib block is NSIS's header, including its UTF-16 table.
  const signature = bytes.indexOf(
    Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex'),
  );
  if (signature < 4) throw new Error('NSIS_HEADER_MISSING');
  const block = signature + 24;
  const length = bytes.readUInt32LE(block);
  const data = bytes.subarray(block + 4, block + 4 + (length & 0x7fffffff));
  const header = length >>> 31 ? inflateRawSync(data) : data;
  const messages = [
    ...source.matchAll(
      /^LangString \w+ \$\{LANG_(?:ENGLISH|GERMAN)\} "(.+)"$/gm,
    ),
  ];
  if (!messages.length) throw new Error('NSIS_MESSAGES_MISSING');
  for (const [, message] of messages) {
    // Variable references use NSIS's encoded opcodes; check each literal span.
    for (const literal of message!
      .split(/\$\w+|\$\\[rn]/)
      .filter((part) => part.length > 2))
      if (!header.includes(Buffer.from(literal, 'utf16le')))
        throw new Error(`NSIS_MESSAGE_BYTES_MISMATCH:${literal}`);
  }
}
