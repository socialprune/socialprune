import type { Diagnostic } from '../model/index.ts';
import type { ArchiveEntry } from './reader.ts';

export type ArchiveReadCode = 'unsupported-compression' | 'encrypted-entry';
export class ArchiveReadError extends Error {
  override readonly name = 'ArchiveReadError';
  readonly code: ArchiveReadCode;
  readonly diagnostic: Diagnostic;
  constructor(code: ArchiveReadCode, entry: ArchiveEntry) {
    super(code);
    this.code = code;
    this.diagnostic = {
      category: code,
      status: 'unreadable',
      files: [entry.path],
      count: 1,
      message:
        code === 'encrypted-entry'
          ? 'Encrypted entries cannot be imported.'
          : 'This entry uses an unsupported compression method.',
    };
  }
}
