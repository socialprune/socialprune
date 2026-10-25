/** Test-owned browser close is not complete until its process wait settles. */
export async function closeProbe(options: {
  close: () => Promise<void>;
  wait: () => Promise<void>;
}): Promise<void> {
  const failures: unknown[] = [];
  try {
    await options.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await options.wait();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, 'BROWSER_PROBE_CLEANUP_FAILED');
}
