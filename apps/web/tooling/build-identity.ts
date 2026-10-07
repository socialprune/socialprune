export function readBuildId(module: string): string {
  const matches = [
    ...module.matchAll(
      /(?:export\s+const\s+buildId\s*=\s*|buildId\s*:\s*)["']([a-f0-9]{24})["']/g,
    ),
  ];
  if (matches.length !== 1)
    throw new Error('Build identity missing or ambiguous in served metadata.');
  return matches[0]![1]!;
}

export function assertBuildIdentity(
  expected: string,
  actual: string,
  origin: string,
): void {
  if (expected !== actual)
    throw new Error(
      `E2E build mismatch at ${origin}: this run built ${expected}, but the answering server served ${actual}. Stop the foreign server or choose an unused test port.`,
    );
}
