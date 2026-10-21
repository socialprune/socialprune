export function assertReleaseEntry(source: string): void {
  if (
    /diagnostic-entry|diagnostic-events=|startup-fixture|startup-case=|limited-token|EnsureUserDefaultDacl|MergeUserDefaultDacl/.test(
      source,
    )
  )
    throw new Error('RELEASE_TEST_ENTRY');
}
