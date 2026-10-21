import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const DIAGNOSE_VARIANTS = [
  'baseline',
  'unrestricted-owned',
  'restricted-session-desktop',
  'lifecycle-test-build',
  'chromium-verbose',
  'software-rendering',
  'no-renderer-sandbox',
] as const;
export type DiagnoseVariant = (typeof DIAGNOSE_VARIANTS)[number];
export function variants(input = ''): DiagnoseVariant[] {
  const values = input
    ? input.split(',').map((part) => part.trim())
    : [...DIAGNOSE_VARIANTS];
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
  commandLineChanged: [
    'chromium-verbose',
    'software-rendering',
    'no-renderer-sandbox',
  ].includes(variant),
  testBuild: variant === 'lifecycle-test-build',
});

// 2026-10-21 runner observations: Add-Type max 45974 ms, release-window
// failure max 45977 ms, NSIS outer lifecycle max 67130 ms. Keep the diagnostic
// outer bound (not the strict readiness predicate) 3 * (67130+45974+45977)
// +100 =477343 ms. The short workflow uses a stricter diagnostic ceiling:
// observed release build/red/faults/failed-controls step221s *1.2 +100=265300ms,
// below its 5min step, and reports timeout rather than weakening readiness.
export const DIAGNOSE_JOB_MS = Math.min(
  (67_130 + 45_974 + 45_977) * 3 + 100,
  221_000 * 1.2 + 100,
);
export const DIAGNOSE_CHILD_SECONDS = Math.ceil(DIAGNOSE_JOB_MS / 1000);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(JSON.stringify(variants(process.argv[2])));
