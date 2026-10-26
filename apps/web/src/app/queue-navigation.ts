import type { WorkspaceClient } from '../workspace/client.ts';

/** Hash history changes must not unmount the owner of a pending human write. */
export function queuedHashNavigation(
  client: () => WorkspaceClient | null,
  accept: (hash: string) => void,
) {
  let generation = 0;
  return () => {
    const hash = location.hash,
      version = ++generation,
      active = client();
    if (!active?.commands.pending) {
      accept(hash);
      return;
    }
    const failures = active.commands.failures;
    void active.flushCommands().then(() => {
      if (version !== generation) return;
      const target =
        active.commands.failures !== failures || active.commands.recovery
          ? '#/review'
          : hash;
      if (target !== location.hash) history.replaceState(null, '', target);
      accept(target);
    });
  };
}
