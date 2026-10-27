// Portable official release, downloaded and hashed on 2026-10-18. No setup exe
// is run. ADR-002 rule 6 and ADR-031 DIST-1 admit the zlib installer stub.
export const NSIS_VERSION = '3.13';
export const NSIS_URL =
  'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip';
// Same pinned release via SourceForge's primary endpoint if a selected mirror fails.
export const NSIS_URLS = [
  NSIS_URL,
  'https://master.dl.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip',
] as const;
export const NSIS_SHA256 =
  'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8';
