export function assertProductionModules(modules: Iterable<string>): void {
  for (const id of modules) {
    if (
      /[/\\](?:test|e2e|fake-x|fake-instagram)[/\\]|engine-test-entry/.test(id)
    )
      throw new Error('PRODUCTION_TEST_IMPORT');
  }
}
