export function assertReleaseEntry(source: string): void {
  if (
    /diagnostic-entry|diagnostic-events=|startup-fixture|startup-case=/.test(
      source,
    )
  )
    throw new Error('RELEASE_TEST_ENTRY');
}
