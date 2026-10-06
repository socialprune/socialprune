export type ViolationReason =
  | 'parent path segment'
  | 'absolute path'
  | 'ZIP extension'
  | 'ZIP header'
  | 'X export assignment'
  | 'Instagram export JSON key';

export interface Violation {
  path: string;
  reason: ViolationReason;
}

const xAssignment = new RegExp(
  ['window', '\\.YTD\\.', '[A-Za-z0-9_]+', '\\.part[0-9]+\\s*='].join(''),
);
const instagramKeys = [
  ['string', 'map', 'data'].join('_'),
  ['string', 'list', 'data'].join('_'),
  ['media', 'owner'].join('_'),
];
const instagramKey = new RegExp(`"(?:${instagramKeys.join('|')})"\\s*:`);
const zipHeaders = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

export function inspectFile(path: string, content: Uint8Array): Violation[] {
  const gitPath = path.replaceAll('\\', '/');
  if (gitPath.split('/').includes('..')) {
    return [{ path, reason: 'parent path segment' }];
  }
  if (gitPath.startsWith('/') || /^[A-Za-z]:/.test(gitPath)) {
    return [{ path, reason: 'absolute path' }];
  }
  if (path.startsWith('fixtures/synthetic/')) return [];

  const violations: Violation[] = [];
  if (/\.zip$/i.test(gitPath))
    violations.push({ path, reason: 'ZIP extension' });
  if (
    zipHeaders.some((header) => header.every((byte, i) => content[i] === byte))
  ) {
    violations.push({ path, reason: 'ZIP header' });
  }

  const text = Buffer.from(content).toString('utf8');
  if (xAssignment.test(text)) {
    violations.push({ path, reason: 'X export assignment' });
  }
  if (instagramKey.test(text)) {
    violations.push({ path, reason: 'Instagram export JSON key' });
  }
  return violations;
}
