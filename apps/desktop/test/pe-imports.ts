// Read-only PE inspection retained by the diagnostic token helper build after
// retiring the temporary launch matrix. Direct imports do not prove runtime
// transitive imports or a user32-free process.
export function peImports(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('MATRIX_NOT_PE');
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(header) !== 0x4550)
    throw new Error('MATRIX_PE_HEADER');
  const optional = header + 24;
  const plus = bytes.readUInt16LE(optional) === 0x20b;
  const directories = optional + (plus ? 112 : 96);
  const sectionCount = bytes.readUInt16LE(header + 6);
  const sections = optional + bytes.readUInt16LE(header + 20);
  function offset(rva: number) {
    for (let i = 0; i < sectionCount; i++) {
      const section = sections + i * 40;
      const start = bytes.readUInt32LE(section + 12);
      const size = Math.max(
        bytes.readUInt32LE(section + 8),
        bytes.readUInt32LE(section + 16),
      );
      if (rva >= start && rva < start + size)
        return rva - start + bytes.readUInt32LE(section + 20);
    }
    throw new Error('MATRIX_PE_RVA');
  }
  function string(rva: number) {
    const start = offset(rva),
      end = bytes.indexOf(0, start);
    if (end < start || end - start > 256) throw new Error('MATRIX_PE_NAME');
    return bytes.toString('ascii', start, end);
  }
  function table(index: number, stride: number, nameOffset: number) {
    const rva = bytes.readUInt32LE(directories + index * 8);
    if (!rva) return [];
    const start = offset(rva),
      result: string[] = [];
    for (let i = 0; i < 1024; i++) {
      const entry = start + i * stride;
      if (bytes.subarray(entry, entry + stride).every((byte) => byte === 0))
        return result;
      if (index === 13 && !(bytes.readUInt32LE(entry) & 1))
        throw new Error('MATRIX_PE_LEGACY_DELAY_VA');
      result.push(string(bytes.readUInt32LE(entry + nameOffset)));
    }
    throw new Error('MATRIX_PE_IMPORT_BOUND');
  }
  return {
    direct: table(1, 20, 12),
    delayed: table(13, 32, 4),
    transitiveImportsChecked: false,
    user32FreeClaim: false,
  };
}
