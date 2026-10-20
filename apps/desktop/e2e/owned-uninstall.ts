import assert from 'node:assert/strict';
import { pollQuery, LAYOUT_POLL_TIMEOUT_MS } from '../packaging/query-poll.ts';

export type ProductLayout = {
  installExists: boolean;
  dataExists: boolean;
  registrationExists: boolean;
  updateExists: boolean;
  existingShortcuts: string[];
  registrations: string[];
};
export type OwnedUninstaller = {
  pid: number;
  born: string;
  imageClass: string;
};
export async function settleOwnedUninstall<T extends ProductLayout>(
  layout: () => Promise<T>,
  ownedProcesses: () => Promise<OwnedUninstaller[]>,
  observe: (value: {
    processes: number;
    productLayoutAbsent: boolean;
    layout: T;
  }) => Promise<void>,
  timeoutMs = LAYOUT_POLL_TIMEOUT_MS,
) {
  const absent = (value: ProductLayout) =>
    !value.installExists &&
    !value.dataExists &&
    !value.registrationExists &&
    !value.updateExists &&
    value.existingShortcuts.length === 0 &&
    value.registrations.length === 0;
  const settled = await pollQuery(
    async () => {
      // Match only the exact installed uninstaller or ~nsu*.tmp/Un.exe images
      // below this run's temp root. A zero outer exit or missing file is not a
      // child-process settlement record. Query errors remain fatal.
      const processes = await ownedProcesses();
      const current = await layout();
      const observation = {
        processes: processes.length,
        productLayoutAbsent: absent(current),
        layout: current,
      };
      await observe(observation);
      return observation;
    },
    (value) => value.processes === 0 && value.productLayoutAbsent,
    {
      timeoutMs,
      intervalMs: 100,
      message: 'OWNED_UNINSTALL_NOT_SETTLED',
    },
  );
  assert.equal(settled.processes, 0, 'OWNED_UNINSTALL_PROCESS_REMAINS');
  assert.equal(
    settled.productLayoutAbsent,
    true,
    'OWNED_UNINSTALL_LAYOUT_REMAINS',
  );
  return settled.layout;
}
