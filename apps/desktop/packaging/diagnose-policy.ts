import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const DIAGNOSE_VARIANTS = [
  'baseline',
  'unrestricted-owned',
  'lifecycle-test-build',
  'token-B-default-dacl',
  'token-C-object-dacl',
  'token-D-object-label',
  'token-E-no-lua',
  'token-chain',
  'restricted-session-desktop',
] as const;
export const DEFAULT_DIAGNOSE_VARIANTS = DIAGNOSE_VARIANTS.filter(
  (name) => name !== 'restricted-session-desktop',
);
export type DiagnoseVariant = (typeof DIAGNOSE_VARIANTS)[number];
export function variants(input = ''): DiagnoseVariant[] {
  const values = input
    ? input.split(',').map((part) => part.trim())
    : [...DEFAULT_DIAGNOSE_VARIANTS];
  if (
    !values.length ||
    new Set(values).size !== values.length ||
    values.some((name) => !DIAGNOSE_VARIANTS.includes(name as DiagnoseVariant))
  )
    throw new Error('DIAGNOSE_VARIANTS_INVALID');
  return values as DiagnoseVariant[];
}
export const diagnosticTerms = (variant: DiagnoseVariant) => ({
  variant,
  diagnosticOnly: true,
  acceptance: false,
  commandLineChanged: false,
  testBuild: variant === 'lifecycle-test-build',
  tokenChange:
    variant.startsWith('token-') && variant !== 'token-chain'
      ? variant
      : 'none',
  tokenOnly: variant === 'token-chain',
});

// R29: one absolute work deadline for the entire step, not one per phase.
// Termination, incremental collection and cleanup share the final 60 seconds.
export const DIAGNOSE_WORK_MS = 240_000;
export const DIAGNOSE_RETURN_MS = 60_000;
export const DIAGNOSE_JOB_MS = DIAGNOSE_WORK_MS + DIAGNOSE_RETURN_MS;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(JSON.stringify(variants(process.argv[2])));
