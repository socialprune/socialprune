import { loadNsisArchive } from './nsis-download.ts';
import { NSIS_SHA256 } from './nsis-version.ts';

// CI preflight runs before any test/compiler consumes this shared archive.
await loadNsisArchive();
console.log('NSIS_ARCHIVE_VERIFIED', NSIS_SHA256);
